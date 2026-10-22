from ml_training import train_experiment
import json, time, threading, random
from datetime import datetime, timedelta
from db import get_db
from croniter import croniter

class Worker:
    def __init__(self, name):
        self.name = name
        self.worker_id = None
        self.running = True

    # -------------------------
    # REGISTER WORKER
    # -------------------------
    def register(self):
        db = get_db()
        cursor = db.cursor()

        cursor.execute("""
            INSERT INTO workers(
                name,
                status,
                last_heartbeat
            )
            VALUES (%s, 'online', NOW())
        """, (self.name,))

        db.commit()

        self.worker_id = cursor.lastrowid
        cursor.close()
        db.close()
        print(
            f"Worker {self.name} "
            f"started with ID {self.worker_id}"
        )

    # -------------------------
    # HEARTBEAT
    # -------------------------
    def heartbeat(self):
        while self.running:
            db = None
            cursor = None

            try:
                db = get_db()
                cursor = db.cursor()

                cursor.execute("""
                    UPDATE workers
                    SET last_heartbeat = NOW(),
                        status = 'online'
                    WHERE id = %s
                """, (self.worker_id,))

                db.commit()

            except Exception as e:
                print("Heartbeat error:", e)

            finally:
                if cursor is not None:
                    cursor.close()

                if db is not None:
                    db.close()

            time.sleep(5)

    # -------------------------
    # CLAIM JOB
    # -------------------------
    def claim_job(self):
        db = get_db()
        cursor = None

        try:
            db.start_transaction()
            cursor = db.cursor(dictionary=True)

            cursor.execute("""
                SELECT j.*
                FROM jobs j
                JOIN queues q ON q.id = j.queue_id
                WHERE j.status IN ('queued', 'scheduled', 'retrying')
                  AND (j.run_at IS NULL OR j.run_at <= NOW())
                  AND q.is_paused = 0
                  AND (
                      SELECT COUNT(*)
                      FROM jobs active
                      WHERE active.queue_id = j.queue_id
                        AND active.status IN ('claimed', 'running')
                  ) < GREATEST(COALESCE(q.concurrency_limit, 1), 1)
                ORDER BY j.priority DESC, j.created_at ASC
                LIMIT 1
                FOR UPDATE
            """)

            job = cursor.fetchone()
            if not job:
                db.rollback()
                return None

            cursor.execute("""
                UPDATE jobs
                SET status = 'claimed',
                    worker_id = %s,
                    attempts = attempts + 1,
                    updated_at = NOW()
                WHERE id = %s
            """, (self.worker_id, job["id"]))

            # Keep the returned record consistent with the database update.
            job["attempts"] = int(job.get("attempts") or 0) + 1
            job["status"] = "claimed"
            job["worker_id"] = self.worker_id
            
            db.commit()

            return job

        except Exception as e:
            db.rollback()
            print("Job claiming error:", e)
            return None

        finally:
            if cursor is not None:
                cursor.close()
            db.close()

    
    def owns_running_job(self, job_id):
        """Check that this worker still owns the running job."""
        db = get_db()
        cursor = None
        try:
            cursor = db.cursor()
            cursor.execute("""
                SELECT id
                FROM jobs
                WHERE id = %s
                  AND worker_id = %s
                  AND status = 'running'
            """, (job_id, self.worker_id))
            return cursor.fetchone() is not None
        finally:
            if cursor is not None:
                cursor.close()
            db.close()

    
    def persist_ml_result(self, job_id, execution_id, result):
        """Save an ML result and complete its job in one transaction."""
        db = get_db()
        cursor = None

        try:
            db.start_transaction()
            cursor = db.cursor(dictionary=True)

            # Lock the job row while validating ownership.
            cursor.execute("""
                SELECT id, worker_id, status, job_type,
                       cron_expression, run_at
                FROM jobs
                WHERE id = %s
                FOR UPDATE
            """, (job_id,))

            job = cursor.fetchone()

            if (
                not job
                or job["worker_id"] != self.worker_id
                or job["status"] != "running"
            ):
                db.rollback()
                print(
                    f"Worker {self.worker_id} lost ownership "
                    f"of job {job_id}; result discarded."
                )
                return False

            # Save the result only after ownership is confirmed.
            cursor.execute("""
                INSERT INTO experiment_results
                    (job_id, algorithm, target_column, task_type,
                     metrics, model_path)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                job_id,
                result["algorithm"],
                result["target_column"],
                result["task_type"],
                json.dumps(result["metrics"]),
                result["model_path"]
            ))

            cursor.execute("""
                INSERT INTO job_logs (job_id, level, message)
                VALUES (%s, 'INFO', %s)
            """, (
                job_id,
                "ML training completed: "
                + json.dumps(result["metrics"])
            ))

            cursor.execute("""
                UPDATE job_executions
                SET status = 'completed', finished_at = NOW()
                WHERE id = %s
                  AND job_id = %s
                  AND worker_id = %s
                  AND status = 'running'
            """, (execution_id, job_id, self.worker_id))

            if cursor.rowcount != 1:
                raise RuntimeError(
                    "Execution is no longer active; result was not committed."
                )

            if job["job_type"] == "recurring" and job["cron_expression"]:
                base_time = job["run_at"] or datetime.now()
                next_run = croniter(
                    job["cron_expression"], base_time
                ).get_next(datetime)

                now = datetime.now()
                while next_run <= now:
                    next_run = croniter(
                        job["cron_expression"], next_run
                    ).get_next(datetime)

                cursor.execute("""
                    UPDATE jobs
                    SET status = 'scheduled',
                        run_at = %s,
                        attempts = 0,
                        worker_id = NULL
                    WHERE id = %s
                """, (next_run, job_id))

                message = (
                    f"Next recurring execution scheduled for {next_run}"
                )
            else:
                cursor.execute("""
                    UPDATE jobs
                    SET status = 'completed', worker_id = NULL
                    WHERE id = %s
                """, (job_id,))
                message = "Job execution completed successfully"

            cursor.execute("""
                INSERT INTO job_logs (job_id, level, message)
                VALUES (%s, 'INFO', %s)
            """, (job_id, message))

            db.commit()
            print(f"ML result saved and job {job_id} completed.")
            return True

        except Exception as e:
            db.rollback()
            print(f"Atomic ML result save failed for job {job_id}: {e}")
            raise

        finally:
            if cursor is not None:
                cursor.close()
            db.close()

    # -------------------------
    # EXECUTE JOB
    # -------------------------
    def execute_job(self, job):
        job_id = job["id"]
        print(
            f"Worker {self.worker_id} "
            f"executing Job {job_id}"
        )
        db = get_db()
        cursor = db.cursor()

        # Mark running
        cursor.execute("""
            UPDATE jobs
            SET status = 'running'
            WHERE id = %s
        """, (job_id,))

        cursor.execute("""
            INSERT INTO job_executions(
                job_id, worker_id, attempt,
                status, started_at
            )
            VALUES ( %s,  %s, %s, 'running', NOW() )
        """, (
            job_id,
            self.worker_id,
            job["attempts"]
        ))
        execution_id = cursor.lastrowid

        db.commit()
        cursor.close()
        db.close()

        try:
            # Run actual ML training for MLLab experiment jobs.
            payload = job.get("payload") or {}

            if isinstance(payload, str):
                payload = json.loads(payload)

            if payload.get("task") == "ml_training":
                result = train_experiment(payload, execution_id=execution_id)

                # Recovery may have reassigned this job while training ran.
                if not self.owns_running_job(job_id):
                    print(f"Worker {self.worker_id} no longer owns job {job_id}; discarding results.")
                    return
                
                # This method already saves the result, execution status,
                # job status and completion logs in one transaction.
                saved = self.persist_ml_result(
                    job["id"],
                    execution_id,
                    result
                )

                if not saved:
                    print(
                        f"ML result was not saved because job {job['id']} "
                        "is no longer owned by this worker."
                    )
                    return

                db = get_db()
                cursor = db.cursor()

                try:
                    db.start_transaction()

                    cursor.execute(
                        """
                        UPDATE jobs
                        SET status = 'running'
                        WHERE id = %s
                        AND worker_id = %s
                        AND status = 'claimed'
                        """,
                        (job["id"], self.worker_id)
                    )

                    if cursor.rowcount != 1:
                        db.rollback()
                        print(f"Job {job['id']} is no longer claimable by this worker.")
                        return

                    cursor.execute(
                        """
                        INSERT INTO job_executions
                            (job_id, worker_id, attempt, status, started_at)
                        VALUES (%s, %s, %s, 'running', NOW())
                        """,
                        (job["id"], self.worker_id, job["attempts"])
                    )

                    execution_id = cursor.lastrowid
                    db.commit()

                finally:
                    cursor.close()
                    db.close()

                                
            else:
                # Preserve the existing behavior for ordinary scheduler jobs.
                time.sleep(random.randint(1, 3))

                if random.random() < 0.2:
                    raise Exception("Simulated job failure")

                self.complete_job(job["id"], execution_id)          

        except Exception as e:
            self.fail_job(job, execution_id, str(e))

    # -------------------------
    # COMPLETE JOB
    # -------------------------
    def complete_job(self, job_id, execution_id):
        db = get_db()
        cursor = db.cursor(dictionary=True)

        try:
            cursor.execute("""
                SELECT job_type, cron_expression, run_at, worker_id, status
                FROM jobs
                WHERE id = %s
                FOR UPDATE
            """, (job_id,))

            job = cursor.fetchone()

            if (
                not job
                or job["worker_id"] != self.worker_id
                or job["status"] != "running"
            ):
                db.rollback()
                print(f"Worker {self.worker_id} cannot complete job {job_id}: ownership lost.")
                return

            cursor.execute("""
                UPDATE job_executions
                SET status = 'completed',
                    finished_at = NOW()
                WHERE id = %s
            """, (execution_id,))

            cursor.execute("""
                INSERT INTO job_logs (job_id, level, message)
                VALUES (%s, 'INFO', %s)
            """, (
                job_id,
                "Job execution completed successfully"
            ))

            if (
                job["job_type"] == "recurring"
                and job["cron_expression"]
            ):
                base_time = job["run_at"] or datetime.now()

                next_run = croniter(
                    job["cron_expression"],
                    base_time
                ).get_next(datetime)

                # Skip missed schedule times rather than rapidly
                # executing several overdue runs back-to-back.
                now = datetime.now()
                while next_run <= now:
                    next_run = croniter(
                        job["cron_expression"],
                        next_run
                    ).get_next(datetime)

                cursor.execute("""
                    UPDATE jobs
                    SET status = 'scheduled',
                        run_at = %s,
                        attempts = 0,
                        worker_id = NULL
                    WHERE id = %s
                """, (next_run, job_id))

                cursor.execute("""
                    INSERT INTO job_logs (job_id, level, message)
                    VALUES (%s, 'INFO', %s)
                """, (
                    job_id,
                    f"Next recurring execution scheduled for {next_run}"
                ))
            else:
                cursor.execute("""
                    UPDATE jobs
                    SET status = 'completed', worker_id = NULL
                    WHERE id = %s
                        AND worker_id = %s
                        AND status = 'running'
                """, (job_id, self.worker_id))

            db.commit()
            print(f"Job {job_id} execution completed")

        except Exception:
            db.rollback()
            raise
        finally:
            cursor.close()
            db.close()

    # -------------------------
    # FAIL JOB
    # -------------------------
    def fail_job(self, job, execution_id, error):
        db = get_db()
        cursor = db.cursor()

        job_id = job["id"]
        attempts = job["attempts"]
        max_retries = job["max_retries"]

        if not self.owns_running_job(job["id"]):
            print(f"Worker {self.worker_id} cannot fail job {job['id']}: ownership lost.")
            return

        cursor.execute("""
            UPDATE job_executions
            SET status = 'failed',
                finished_at = NOW(),
                error_message = %s
            WHERE id = %s
        """, ( error, execution_id ))

        cursor.execute("""
            INSERT INTO job_logs(
                job_id, level, message
            )
            VALUES(%s, 'ERROR', %s
            )
        """, (job_id, error))

        # Retry
        if attempts < max_retries:
            delay = self.calculate_retry_delay(
                job, attempts)

            next_run = (
                datetime.now()
                + timedelta(seconds=delay)
            )

            cursor.execute("""
                UPDATE jobs
                SET status = 'retrying',
                    run_at = %s
                WHERE id = %s
            """, (next_run, job_id
            ))
            print(
                f"Job {job_id} failed."
                f" Retrying in {delay}s"
            )
        else:
            # Dead Letter Queue
            cursor.execute("""
                UPDATE jobs
                SET status = 'dead'
                WHERE id = %s
            """, (job_id,))

            cursor.execute("""
                INSERT INTO dead_letter_jobs(
                    job_id, reason
                )
                VALUES( %s, %s)
            """, (job_id, error))
            print(f"Job {job_id} moved to DLQ")

        db.commit()
        cursor.close()
        db.close()

    # -------------------------
    # RETRY DELAY
    # -------------------------
    def calculate_retry_delay(self,job,attempt):
        db = get_db()
        cursor = db.cursor()

        cursor.execute("""
            SELECT
                retry_strategy,
                retry_delay
            FROM queues
            WHERE id = %s
        """, (
            job["queue_id"],
        ))
        result = cursor.fetchone()
        cursor.close()
        db.close()

        if not result:
            return 5

        strategy = result[0]
        base_delay = result[1] or 5

        if strategy == "fixed":
            return base_delay

        elif strategy == "linear":
            return base_delay * attempt

        elif strategy == "exponential":
            return base_delay * (
                2 ** (attempt - 1)
            )
        return base_delay

    
    # -------------------------
    # RECOVER JOBS FROM CRASHED WORKERS
    # -------------------------
    def recover_stale_jobs(self):
        db = get_db()
        cursor = None

        try:
            db.start_transaction()
            cursor = db.cursor(dictionary=True)

            # Find jobs whose workers have stopped sending heartbeats.
            cursor.execute("""
                SELECT
                    j.id,
                    j.queue_id,
                    j.status,
                    j.attempts,
                    j.max_retries,
                    j.worker_id
                FROM jobs j
                JOIN workers w ON w.id = j.worker_id
                WHERE j.status IN ('claimed', 'running')
                  AND (
                      w.last_heartbeat IS NULL
                      OR w.last_heartbeat <
                         DATE_SUB(NOW(), INTERVAL 30 SECOND)
                  )
                FOR UPDATE
            """)

            stale_jobs = cursor.fetchall()

            for job in stale_jobs:
                job_id = job["id"]
                worker_id = job["worker_id"]
                attempts = int(job["attempts"] or 0)
                max_retries = int(job["max_retries"] or 0)

                error_message = (
                    f"Worker {worker_id} stopped responding. "
                    "Execution interrupted; job recovered automatically."
                )

                # Mark the latest unfinished execution as failed.
                cursor.execute("""
                    SELECT id
                    FROM job_executions
                    WHERE job_id = %s
                      AND worker_id = %s
                      AND status = 'running'
                    ORDER BY id DESC
                    LIMIT 1
                    FOR UPDATE
                """, (job_id, worker_id))

                execution = cursor.fetchone()

                if execution:
                    cursor.execute("""
                        UPDATE job_executions
                        SET status = 'failed',
                            finished_at = NOW(),
                            error_message = %s
                        WHERE id = %s
                    """, (error_message, execution["id"]))

                cursor.execute("""
                    INSERT INTO job_logs (job_id, level, message)
                    VALUES (%s, 'ERROR', %s)
                """, (job_id, error_message))

                if attempts < max_retries:
                    # Reuse the queue's existing retry strategy.
                    delay = self.calculate_retry_delay(job, attempts)
                    next_run = datetime.now() + timedelta(seconds=delay)

                    cursor.execute("""
                        UPDATE jobs
                        SET status = 'retrying',
                            run_at = %s,
                            worker_id = NULL
                        WHERE id = %s
                    """, (next_run, job_id))

                    cursor.execute("""
                        INSERT INTO job_logs (job_id, level, message)
                        VALUES (%s, 'INFO', %s)
                    """, (
                        job_id,
                        f"Recovered job scheduled for retry in {delay} seconds."
                    ))

                    print(
                        f"Recovered Job {job_id}; "
                        f"retry scheduled in {delay}s"
                    )

                else:
                    cursor.execute("""
                        UPDATE jobs
                        SET status = 'dead',
                            worker_id = NULL
                        WHERE id = %s
                    """, (job_id,))

                    cursor.execute("""
                        INSERT INTO dead_letter_jobs (job_id, reason)
                        VALUES (%s, %s)
                    """, (job_id, error_message))

                    print(
                        f"Recovered Job {job_id}; "
                        "retry limit reached, moved to DLQ"
                    )

            # Mark workers with stale heartbeats offline.
            cursor.execute("""
                UPDATE workers
                SET status = 'offline'
                WHERE last_heartbeat IS NULL
                   OR last_heartbeat <
                      DATE_SUB(NOW(), INTERVAL 30 SECOND)
            """)

            db.commit()

        except Exception as e:
            db.rollback()
            print("Stale job recovery error:", e)

        finally:
            if cursor is not None:
                cursor.close()
            db.close()


    # -------------------------
    # WORKER LOOP
    # -------------------------
    def run(self):
        self.register()

        heartbeat_thread = threading.Thread(
            target=self.heartbeat,
            daemon=True
        )
        heartbeat_thread.start()
        print("Worker is waiting for jobs...")

        while self.running:
            try:
                self.recover_stale_jobs()
                job = self.claim_job()

                if job:
                    self.execute_job(job)
                else:
                    time.sleep(2)

            except KeyboardInterrupt:
                self.stop()

            except Exception as e:
                print("Worker error:", e)
                time.sleep(2)

    # -------------------------
    # STOP WORKER
    # -------------------------
    def stop(self):
        self.running = False

        if self.worker_id:
            db = get_db()
            cursor = db.cursor()

            cursor.execute("""
                UPDATE workers
                SET status = 'offline'
                WHERE id = %s
            """, (
                self.worker_id,
            ))

            db.commit()
            cursor.close()
            db.close()

        print(f"Worker {self.worker_id} stopped")


if __name__ == "__main__":
    worker = Worker("worker-1")
    worker.run()