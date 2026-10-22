from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
import jwt, os, uuid, json
from datetime import datetime, timedelta
from flask_jwt_extended import jwt_required
import pandas as pd
from croniter import croniter

from flask import current_app
from werkzeug.utils import secure_filename
from config import SECRET_KEY
from models import (
    create_user,
    get_user_by_email,
    create_project,
    get_projects,
    create_queue,
    get_queues
)
from db import get_db

routes = Blueprint("routes", __name__)

# Dataset upload settings
ALLOWED_DATASET_EXTENSIONS = {"csv"}
MAX_DATASET_SIZE = 20 * 1024 * 1024  # 20 MB


# Dataset storage folder
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_FOLDER = os.path.join(BASE_DIR, "uploads", "datasets")
os.makedirs(DATASET_FOLDER, exist_ok=True)


def get_upload_folder():
    folder = os.path.join(
        current_app.root_path,
        "uploads",
        "datasets"
    )
    os.makedirs(folder, exist_ok=True)
    return folder


@routes.post("/datasets/upload")
def upload_dataset():
    user = get_current_user()

    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    uploaded_file = request.files.get("file")
    project_id = request.form.get("project_id")

    if not uploaded_file or not uploaded_file.filename:
        return jsonify({"error": "Please select a CSV file"}), 400

    original_filename = secure_filename(uploaded_file.filename)

    if not original_filename.lower().endswith(".csv"):
        return jsonify({"error": "Only CSV files are allowed"}), 400

    if not project_id or not project_id.isdigit():
        return jsonify({"error": "A valid project_id is required"}), 400

    stored_filename = f"{uuid.uuid4().hex}.csv"
    upload_folder = get_upload_folder()
    file_path = os.path.join(upload_folder, stored_filename)

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        # Ensure this project belongs to the logged-in user.
        cursor.execute(
            "SELECT id FROM projects WHERE id = %s AND user_id = %s",
            (int(project_id), user["user_id"])
        )
        project = cursor.fetchone()

        if not project:
            return jsonify({"error": "Project not found"}), 404

        uploaded_file.save(file_path)

        if os.path.getsize(file_path) > MAX_DATASET_SIZE:
            os.remove(file_path)
            return jsonify({
                "error": "CSV must be 20 MB or smaller"
            }), 400

        try:
            df = pd.read_csv(file_path, nrows=10000)

            if df.empty or len(df.columns) < 2:
                raise ValueError(
                    "CSV must contain data and at least two columns"
                )

            with open(file_path, "rb") as csv_file:
                row_count = max(sum(1 for _ in csv_file) - 1, 0)

        except Exception:
            if os.path.exists(file_path):
                os.remove(file_path)

            return jsonify({
                "error": "Could not read this CSV. Check its format and columns."
            }), 400

        cursor.execute("""
            INSERT INTO datasets (
                user_id,
                project_id,
                original_filename,
                stored_filename,
                file_path,
                row_count,
                columns_json
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            user["user_id"],
            int(project_id),
            original_filename,
            stored_filename,
            file_path,
            row_count,
            json.dumps([str(column) for column in df.columns])
        ))

        db.commit()
        dataset_id = cursor.lastrowid

        return jsonify({
            "message": "Dataset uploaded successfully",
            "dataset": {
                "id": dataset_id,
                "original_filename": original_filename,
                "project_id": int(project_id),
                "row_count": row_count,
                "columns": [str(column) for column in df.columns]
            }
        }), 201

    except Exception:
        db.rollback()

        if os.path.exists(file_path):
            os.remove(file_path)

        current_app.logger.exception("Dataset upload failed")
        return jsonify({"error": "Dataset upload failed"}), 500

    finally:
        cursor.close()
        db.close()


@routes.get("/datasets")
def list_datasets():
    user = get_current_user()

    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    project_id = request.args.get("project_id")

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        query = """
            SELECT id, project_id, original_filename,
                   row_count, columns_json, created_at
            FROM datasets
            WHERE user_id = %s
        """
        params = [user["user_id"]]

        if project_id:
            if not project_id.isdigit():
                return jsonify({"error": "Invalid project_id"}), 400
            query += " AND project_id = %s"
            params.append(int(project_id))

        query += " ORDER BY created_at DESC"
        cursor.execute(query, params)
        datasets = cursor.fetchall()

        for dataset in datasets:
            if isinstance(dataset.get("columns_json"), str):
                import json
                dataset["columns"] = json.loads(dataset["columns_json"])
            else:
                dataset["columns"] = dataset.get("columns_json") or []
            dataset.pop("columns_json", None)

            if dataset.get("created_at"):
                dataset["created_at"] = dataset["created_at"].isoformat()

        return jsonify(datasets)

    finally:
        cursor.close()
        db.close()


# =========================
# AUTHENTICATION
# =========================
@routes.before_request
def check_auth():
    if request.method == "OPTIONS":
        return "", 204


@routes.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")

    allowed_origins = {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    }

    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, Authorization"
        )
        response.headers["Access-Control-Allow-Methods"] = (
            "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        )
    return response
    

def get_current_user():
    auth = request.headers.get("Authorization")

    if not auth:
        return None

    try:
        token = auth.split(" ")[1]
        return jwt.decode(
            token,
            SECRET_KEY,
            algorithms=["HS256"]
        )
    except Exception:
        return None


@routes.post("/register")
def register():
    data = request.get_json()

    name = data.get("name")
    email = data.get("email")
    password = data.get("password")

    if not name or not email or not password:
        return jsonify({
            "error": "All fields are required"
        }), 400

    if get_user_by_email(email):
        return jsonify({
            "error": "Email already registered"
        }), 409

    hashed_password = generate_password_hash(password)

    user_id = create_user(name, email, hashed_password)
    
    return jsonify({
        "message": "Registration successful",
        "user_id": user_id
    }), 201
    

@routes.post("/login")
def login():
    data = request.get_json()
    email = data.get("email")
    password = data.get("password")

    user = get_user_by_email(email)

    if not user:
        return jsonify({
            "error": "Invalid email or password"
        }), 401

    if not check_password_hash(
        user["password"],
        password
    ):

        return jsonify({
            "error": "Invalid email or password"
        }), 401

    token = jwt.encode(
        {
            "user_id": user["id"],
            "role": user["role"],
            "exp": datetime.utcnow() + timedelta(hours=24)
        },
        SECRET_KEY,
        algorithm="HS256"
    )

    return jsonify({
        "token": token,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "role": user["role"]
        }
    })



# =========================
# PROJECTS
# =========================

@routes.route("/projects", methods=["GET", "POST"])
def manage_projects():
    user = get_current_user()

    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    user_id = user["user_id"]

    # List projects belonging to the logged-in user
    if request.method == "GET":
        return jsonify(get_projects(user_id)), 200

    # Create a new project
    data = request.get_json(silent=True) or {}

    name = data.get("name", "").strip()
    description = data.get("description", "").strip()

    if not name:
        return jsonify({"error": "Project name is required"}), 400

    try:
        project_id = create_project(
            user_id,
            name,
            description
        )

        # Automatically create a default queue for this project.
        queue_id = create_queue(
            project_id,
            "Default Training Queue",
            1,       # priority
            2,       # concurrency limit
            3,       # max retries
            "fixed", # retry strategy
            5        # retry delay in seconds
        )

        return jsonify({
            "message": "Project and default queue created successfully",
            "project_id": project_id,
            "queue_id": queue_id,
            "name": name,
            "description": description
        }), 201

    except Exception:
        current_app.logger.exception(
            "Project or default queue creation failed"
        )
        return jsonify({
            "error": "Could not create project and default queue"
        }), 500


# =========================
# QUEUES
# =========================
def queues_options():
    return "", 204

@routes.route("/queues", methods=["POST"])
def add_queue():
    user = get_current_user()

    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    project_id = data.get("project_id")
    name = (data.get("name") or "").strip()

    if not project_id or not str(project_id).isdigit() or not name:
        return jsonify({
            "error": "A valid project_id and queue name are required"
        }), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute(
            "SELECT id FROM projects WHERE id = %s AND user_id = %s",
            (int(project_id), user["user_id"])
        )
        project = cursor.fetchone()

        if not project:
            return jsonify({"error": "Project not found"}), 404

        queue_id = create_queue(
            int(project_id),
            name,
            data.get("priority", 1),
            data.get("concurrency_limit", 2),
            data.get("max_retries", 3),
            data.get("retry_strategy", "fixed"),
            data.get("retry_delay", 5)
        )

        return jsonify({
            "message": "Queue created successfully",
            "queue_id": queue_id
        }), 201

    except Exception:
        db.rollback()
        current_app.logger.exception("Queue creation failed")
        return jsonify({"error": "Could not create queue"}), 500

    finally:
        cursor.close()
        db.close()

 
@routes.get("/queues/<int:project_id>")
def list_queues(project_id):
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("""
            SELECT q.id, q.project_id, q.name, q.concurrency_limit, q.is_paused
            FROM queues q
            JOIN projects p ON p.id = q.project_id
            WHERE q.project_id = %s AND p.user_id = %s
        """, (project_id, user["user_id"]))

        return jsonify(cursor.fetchall()), 200
    except Exception:
        current_app.logger.exception("Could not load queues")
        return jsonify({"error": "Could not load queues"}), 500
    finally:
        cursor.close()
        db.close()


@routes.patch("/queues/<int:queue_id>/pause")
def pause_queue(queue_id):
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    cursor = db.cursor()

    try:
        cursor.execute("""
            UPDATE queues q
            JOIN projects p ON p.id = q.project_id
            SET q.is_paused = 1
            WHERE q.id = %s AND p.user_id = %s
        """, (queue_id, user["user_id"]))

        db.commit()

        if cursor.rowcount == 0:
            # Distinguish an already-paused queue from a missing
            # or unauthorized queue.
            cursor.execute("""
                SELECT q.id
                FROM queues q
                JOIN projects p ON p.id = q.project_id
                WHERE q.id = %s AND p.user_id = %s
            """, (queue_id, user["user_id"]))

            if not cursor.fetchone():
                return jsonify({"error": "Queue not found"}), 404

        return jsonify({
            "message": "Queue paused",
            "queue_id": queue_id,
            "is_paused": True
        }), 200

    except Exception:
        db.rollback()
        current_app.logger.exception("Failed to pause queue")
        return jsonify({"error": "Could not pause queue"}), 500

    finally:
        cursor.close()
        db.close()


@routes.patch("/queues/<int:queue_id>/resume")
def resume_queue(queue_id):
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    cursor = db.cursor()

    try:
        cursor.execute("""
            UPDATE queues q
            JOIN projects p ON p.id = q.project_id
            SET q.is_paused = 0
            WHERE q.id = %s AND p.user_id = %s
        """, (queue_id, user["user_id"]))

        db.commit()

        if cursor.rowcount == 0:
            cursor.execute("""
                SELECT q.id
                FROM queues q
                JOIN projects p ON p.id = q.project_id
                WHERE q.id = %s AND p.user_id = %s
            """, (queue_id, user["user_id"]))

            if not cursor.fetchone():
                return jsonify({"error": "Queue not found"}), 404

        return jsonify({
            "message": "Queue resumed",
            "queue_id": queue_id,
            "is_paused": False
        }), 200

    except Exception:
        db.rollback()
        current_app.logger.exception("Failed to resume queue")
        return jsonify({"error": "Could not resume queue"}), 500

    finally:
        cursor.close()
        db.close()

# =========================
# JOBS
# =========================
@routes.post("/jobs")
def create_job():
    user = get_current_user()

    if not user:
        return jsonify({
            "error": "Unauthorized"
        }), 401

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"error": "A valid JSON object is required"}), 400

    queue_id = data.get("queue_id")
    name = data.get("name", "Unnamed Job")
    payload = data.get("payload", {})
    job_type = data.get("job_type", "immediate")
    run_at = data.get("run_at")
    cron = data.get("cron_expression")
    priority = data.get("priority", 1)

    # Validate queue ID
    if not str(queue_id or "").isdigit() or int(queue_id) <= 0:
        return jsonify({"error": "A valid queue_id is required"}), 400

    # Validate job name
    if not isinstance(name, str) or not name.strip():
        return jsonify({"error": "Job name cannot be empty"}), 400

    name = name.strip()

    # Validate job type
    allowed_job_types = {"immediate", "delayed", "scheduled", "recurring"}

    if job_type not in allowed_job_types:
        return jsonify({"error": "Invalid job_type"}), 400

    # Validate payload
    if not isinstance(payload, dict):
        return jsonify({"error": "payload must be a JSON object"}), 400

    # Validate priority
    if isinstance(priority, bool) or not isinstance(priority, int):
        return jsonify({"error": "priority must be an integer"}), 400

    if not 1 <= priority <= 10:
        return jsonify({"error": "priority must be between 1 and 10"}), 400

    # Validate scheduled jobs
    if job_type in {"delayed", "scheduled"}:
        if not run_at:
            return jsonify({"error": "run_at is required for scheduled jobs"}), 400

        try:
            run_at = datetime.fromisoformat(
                run_at.replace("Z", "+00:00")
            )
        except (ValueError, AttributeError):
            return jsonify({
                "error": "run_at must be a valid ISO date/time"
            }), 400

        if run_at.tzinfo is not None:
            from datetime import timezone
            run_at = run_at.astimezone(timezone.utc).replace(tzinfo=None)

        if run_at <= datetime.utcnow():
            return jsonify({"error": "run_at must be in the future"}), 400

    # Validate recurring jobs
    if job_type == "recurring":
        if not isinstance(cron, str) or not croniter.is_valid(cron):
            return jsonify({
                "error": "A valid five-field cron_expression is required"
            }), 400

        run_at = croniter(cron, datetime.utcnow()).get_next(datetime)


    if not queue_id:
        return jsonify({
            "error": "queue_id is required"
        }), 400

    status = "queued"

    if job_type in ["delayed", "scheduled", "recurring"]:
        status = "scheduled"

    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        """
        SELECT q.max_retries, q.project_id
        FROM queues q
        JOIN projects p ON p.id = q.project_id
        WHERE q.id = %s
        AND p.user_id = %s
        """,
        (queue_id, user["user_id"])
    )

    queue = cursor.fetchone()

    if not queue:
        cursor.close()
        db.close()

        return jsonify({
            "error": "Queue not found"
        }), 404

    max_retries, project_id = queue

    if payload.get("task") == "ml_training":
        dataset_id = payload.get("dataset_id")

        if (
            isinstance(dataset_id, bool)
            or not isinstance(dataset_id, int)
            or dataset_id <= 0
        ):
            cursor.close()
            db.close()
            return jsonify({"error": "A valid dataset_id is required."}), 400

        cursor.execute(
            """
            SELECT d.id
            FROM datasets d
            JOIN projects p ON p.id = d.project_id
            JOIN queues q ON q.project_id = p.id
            WHERE d.id = %s
            AND d.user_id = %s
            AND d.project_id = %s
            AND q.id = %s
            """,
            (
                dataset_id,
                user["user_id"],
                project_id,
                queue_id
            )
        )

        if cursor.fetchone() is None:
            cursor.close()
            db.close()
            return jsonify({
                "error": "The dataset does not belong to this user's selected project."
            }), 403
    
    cursor.execute(
        """
        INSERT INTO jobs(
            queue_id,
            job_type,
            name,
            payload,
            status,
            priority,
            run_at,
            cron_expression,
            max_retries
        )
        VALUES (
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s
        )"""
    )
    db.commit()
    job_id = cursor.lastrowid

    cursor.close()
    db.close()

    return jsonify({
        "message": "Job created",
        "job_id": job_id
    }), 201


@routes.get("/jobs")
def get_jobs():
    user = get_current_user()

    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    queue_id = request.args.get("queue_id")
    status = request.args.get("status")

    valid_statuses = {
        "queued", "scheduled", "claimed", "running",
        "completed", "failed", "retrying", "dead"
    }

    if status and status not in valid_statuses:
        return jsonify({"error": "Invalid job status"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        query = """
            SELECT j.*
            FROM jobs j
            JOIN queues q ON q.id = j.queue_id
            JOIN projects p ON p.id = q.project_id
            WHERE p.user_id = %s
        """
        params = [user["user_id"]]

        if queue_id:
            if not queue_id.isdigit():
                return jsonify({"error": "Invalid queue_id"}), 400

            query += " AND j.queue_id = %s"
            params.append(int(queue_id))

        if status:
            query += " AND j.status = %s"
            params.append(status)

        query += " ORDER BY j.priority DESC, j.created_at DESC"

        cursor.execute(query, params)
        jobs = cursor.fetchall()

        return jsonify(jobs)

    finally:
        cursor.close()
        db.close()

# =========================
# JOB MONITORING
# =========================
def get_owned_job(cursor, job_id, user_id):
    cursor.execute("""
        SELECT j.*
        FROM jobs j
        JOIN queues q ON q.id = j.queue_id
        JOIN projects p ON p.id = q.project_id
        WHERE j.id = %s AND p.user_id = %s
    """, (job_id, user_id))

    return cursor.fetchone()


@routes.get("/jobs/<int:job_id>")
def get_job_details(job_id):
    user = get_current_user()

    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        job = get_owned_job(cursor, job_id, user["user_id"])

        if not job:
            return jsonify({"error": "Job not found"}), 404

        # Convert JSON payloads into regular JSON objects where possible.
        if isinstance(job.get("payload"), str):
            try:
                job["payload"] = json.loads(job["payload"])
            except (ValueError, TypeError):
                pass

        for field in ("created_at", "updated_at", "run_at"):
            if job.get(field):
                job[field] = job[field].isoformat()

        return jsonify(job)

    finally:
        cursor.close()
        db.close()


@routes.get("/jobs/<int:job_id>/executions")
def get_job_executions(job_id):
    user = get_current_user()

    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        job = get_owned_job(cursor, job_id, user["user_id"])

        if not job:
            return jsonify({"error": "Job not found"}), 404

        cursor.execute("""
            SELECT id, job_id, worker_id, attempt, status,
                   started_at, finished_at, error_message
            FROM job_executions
            WHERE job_id = %s
            ORDER BY attempt DESC, id DESC
        """, (job_id,))

        executions = cursor.fetchall()

        for execution in executions:
            for field in ("started_at", "finished_at"):
                if execution.get(field):
                    execution[field] = execution[field].isoformat()

        return jsonify(executions)

    finally:
        cursor.close()
        db.close()


@routes.get("/jobs/<int:job_id>/logs")
def get_job_logs(job_id):
    user = get_current_user()

    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        job = get_owned_job(cursor, job_id, user["user_id"])

        if not job:
            return jsonify({"error": "Job not found"}), 404

        cursor.execute("""
            SELECT id, job_id, level, message, created_at
            FROM job_logs
            WHERE job_id = %s
            ORDER BY created_at DESC, id DESC
            LIMIT 200
        """, (job_id,))

        logs = cursor.fetchall()

        for log in logs:
            if log.get("created_at"):
                log["created_at"] = log["created_at"].isoformat()

        return jsonify(logs)

    finally:
        cursor.close()
        db.close()

# =========================
# RETRY JOB
# =========================
@routes.post("/jobs/<int:job_id>/retry")
def retry_job(job_id):
    user = get_current_user()

    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        job = get_owned_job(cursor, job_id, user["user_id"])

        if not job:
            return jsonify({"error": "Job not found"}), 404

        if job["status"] not in ("failed", "dead"):
            return jsonify({
                "error": "Only failed or dead jobs can be retried"
            }), 400

        cursor.execute("""
            UPDATE jobs
            SET status = 'queued',
                attempts = 0,
                run_at = NULL,
                worker_id = NULL
            WHERE id = %s
                AND status IN ('failed', 'dead')
        """, (job_id,))

        cursor.execute("""
            INSERT INTO job_logs (job_id, level, message)
            VALUES (%s, 'INFO', %s)
        """, (job_id, "Manual retry requested"))

        db.commit()

        return jsonify({"message": "Job queued for retry"})

    except Exception:
        db.rollback()
        current_app.logger.exception("Could not retry job")
        return jsonify({"error": "Could not retry job"}), 500

    finally:
        cursor.close()
        db.close()


# =========================
# EXPERIMENT RESULTS
# =========================
@routes.get("/experiment-results")
def experiment_results():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("""
            SELECT er.id, er.job_id, j.name AS job_name,
                   er.algorithm, er.target_column, er.task_type,
                   er.metrics, er.model_path
            FROM experiment_results er
            JOIN jobs j ON j.id = er.job_id
            JOIN queues q ON q.id = j.queue_id
            JOIN projects p ON p.id = q.project_id
            WHERE p.user_id = %s
            ORDER BY er.id DESC
        """, (user["user_id"],))

        results = cursor.fetchall()

        for result in results:
            if result.get("metrics") and isinstance(result["metrics"], str):
                try:
                    result["metrics"] = json.loads(result["metrics"])
                except (ValueError, TypeError):
                    result["metrics"] = {}

        return jsonify(results), 200
    except Exception:
        current_app.logger.exception("Loading experiment results failed")
        return jsonify({"error": "Could not load experiment results"}), 500
    finally:
        cursor.close()
        db.close()


# =========================
# WORKER MONITORING
# =========================
@routes.get("/workers")
def list_workers():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("""
            SELECT
                w.id,
                w.name,
                CASE
                    WHEN w.last_heartbeat IS NULL
                         OR w.last_heartbeat < DATE_SUB(NOW(), INTERVAL 20 SECOND)
                    THEN 'offline'
                    ELSE w.status
                END AS status,
                w.last_heartbeat,
                (
                    SELECT j.id
                    FROM jobs j
                    JOIN queues q ON q.id = j.queue_id
                    JOIN projects p ON p.id = q.project_id
                    WHERE j.worker_id = w.id
                      AND p.user_id = %s
                      AND j.status IN ('claimed', 'running')
                    ORDER BY j.id DESC
                    LIMIT 1
                ) AS current_job_id,
                (
                    SELECT j.name
                    FROM jobs j
                    JOIN queues q ON q.id = j.queue_id
                    JOIN projects p ON p.id = q.project_id
                    WHERE j.worker_id = w.id
                      AND p.user_id = %s
                      AND j.status IN ('claimed', 'running')
                    ORDER BY j.id DESC
                    LIMIT 1
                ) AS current_job_name,
                (
                    SELECT COUNT(*)
                    FROM jobs j
                    JOIN queues q ON q.id = j.queue_id
                    JOIN projects p ON p.id = q.project_id
                    WHERE j.worker_id = w.id
                      AND p.user_id = %s
                      AND j.status = 'completed'
                ) AS completed_jobs,
                (
                    SELECT COUNT(*)
                    FROM jobs j
                    JOIN queues q ON q.id = j.queue_id
                    JOIN projects p ON p.id = q.project_id
                    WHERE j.worker_id = w.id
                      AND p.user_id = %s
                      AND j.status IN ('failed', 'dead')
                ) AS failed_jobs
            FROM workers w
            WHERE EXISTS (
                SELECT 1
                FROM jobs owned_job
                JOIN queues owned_queue
                    ON owned_queue.id = owned_job.queue_id
                JOIN projects owned_project
                    ON owned_project.id = owned_queue.project_id
                WHERE owned_job.worker_id = w.id
                AND owned_project.user_id = %s
            )
            ORDER BY w.id DESC
        """, (
            user["user_id"],
            user["user_id"],
            user["user_id"],
            user["user_id"],
            user["user_id"]
        ))

        workers = cursor.fetchall()
        for worker in workers:
            if worker.get("last_heartbeat"):
                worker["last_heartbeat"] = worker["last_heartbeat"].isoformat()

        return jsonify(workers), 200
    except Exception:
        current_app.logger.exception("Loading workers failed")
        return jsonify({"error": "Could not load workers"}), 500
    finally:
        cursor.close()
        db.close()






