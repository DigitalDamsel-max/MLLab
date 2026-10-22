from db import get_db

def create_user(name, email, password, role="user"):
    db = get_db()
    cursor = db.cursor()

    cursor.execute("""
        INSERT INTO users(name, email, password, role)
        VALUES (%s, %s, %s, %s)
    """, (name, email, password, role))

    db.commit()

    user_id = cursor.lastrowid

    cursor.close()
    db.close()

    return user_id


def get_user_by_email(email):
    db = get_db()
    cursor = db.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM users WHERE email = %s",
        (email,)
    )

    user = cursor.fetchone()

    cursor.close()
    db.close()

    return user


def create_project(user_id, name, description):
    db = get_db()
    cursor = db.cursor()

    cursor.execute("""
        INSERT INTO projects(user_id, name, description)
        VALUES (%s, %s, %s)
    """, (user_id, name, description))

    db.commit()

    project_id = cursor.lastrowid

    cursor.close()
    db.close()

    return project_id


def get_projects(user_id):
    db = get_db()
    cursor = None

    try:
        cursor = db.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT *
            FROM projects
            WHERE user_id = %s
            ORDER BY created_at DESC
            """,
            (user_id,)
        )

        return cursor.fetchall()

    finally:
        if cursor is not None:
            cursor.close()
        db.close()


def create_queue(
    project_id,
    name,
    priority=1,
    concurrency_limit=2,
    max_retries=3,
    retry_strategy="fixed",
    retry_delay=5
):

    db = get_db()
    cursor = db.cursor()

    cursor.execute("""
        INSERT INTO queues (
            project_id,
            name,
            priority,
            concurrency_limit,
            max_retries,
            retry_strategy,
            retry_delay
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, (
        project_id,
        name,
        priority,
        concurrency_limit,
        max_retries,
        retry_strategy,
        retry_delay
    ))

    db.commit()

    queue_id = cursor.lastrowid

    cursor.close()
    db.close()

    return queue_id


def get_queues(project_id):
    db = get_db()
    cursor = db.cursor(dictionary=True)

    cursor.execute("""
        SELECT *
        FROM queues
        WHERE project_id = %s
        ORDER BY priority DESC
    """, (project_id,))

    queues = cursor.fetchall()

    cursor.close()
    db.close()

    return queues