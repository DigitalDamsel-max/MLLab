USE job_scheduler;

CREATE TABLE `job_dependencies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `job_id` int NOT NULL,
  `depends_on_job_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `job_id` (`job_id`),
  KEY `depends_on_job_id` (`depends_on_job_id`),
  CONSTRAINT `job_dependencies_ibfk_1` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `job_dependencies_ibfk_2` FOREIGN KEY (`depends_on_job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `job_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `job_id` int NOT NULL,
  `level` enum('INFO','WARNING','ERROR') DEFAULT 'INFO',
  `message` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `job_id` (`job_id`),
  CONSTRAINT `job_logs_ibfk_1` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `job_executions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `job_id` int NOT NULL,
  `worker_id` int DEFAULT NULL,
  `attempt` int NOT NULL,
  `status` enum('running','completed','failed') DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `error_message` text,
  PRIMARY KEY (`id`),
  KEY `worker_id` (`worker_id`),
  KEY `idx_execution_job` (`job_id`),
  CONSTRAINT `job_executions_ibfk_1` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `job_executions_ibfk_2` FOREIGN KEY (`worker_id`) REFERENCES `workers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `jobs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `queue_id` int NOT NULL,
  `job_type` enum('immediate','delayed','scheduled','recurring','batch') DEFAULT 'immediate',
  `name` varchar(150) DEFAULT NULL,
  `payload` json NOT NULL,
  `status` enum('queued','scheduled','claimed','running','completed','failed','retrying','dead') DEFAULT 'queued',
  `priority` int DEFAULT '1',
  `run_at` datetime DEFAULT NULL,
  `cron_expression` varchar(100) DEFAULT NULL,
  `attempts` int DEFAULT '0',
  `max_retries` int DEFAULT '3',
  `worker_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_job_queue_status` (`queue_id`,`status`),
  KEY `idx_job_run_at` (`run_at`),
  CONSTRAINT `jobs_ibfk_1` FOREIGN KEY (`queue_id`) REFERENCES `queues` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projects` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `queues` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `priority` int DEFAULT '1',
  `concurrency_limit` int DEFAULT '2',
  `max_retries` int DEFAULT '3',
  `retry_strategy` enum('fixed','linear','exponential') DEFAULT 'fixed',
  `retry_delay` int DEFAULT '5',
  `is_paused` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `project_id` (`project_id`,`name`),
  CONSTRAINT `queues_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=69 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('admin','user') DEFAULT 'user',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `workers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `status` enum('online','offline','stopping') DEFAULT 'offline',
  `last_heartbeat` datetime DEFAULT NULL,
  `current_jobs` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS datasets (
    id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    project_id INT NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    row_count INT DEFAULT NULL,
    columns_json JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    CONSTRAINT fk_datasets_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_datasets_project
        FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS experiment_results (
    id INT NOT NULL AUTO_INCREMENT,
    job_id INT NOT NULL,
    algorithm VARCHAR(100) NOT NULL,
    target_column VARCHAR(255) NOT NULL,
    task_type VARCHAR(30) NOT NULL,
    metrics JSON DEFAULT NULL,
    model_path VARCHAR(500) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY unique_experiment_result (job_id),

    CONSTRAINT fk_results_job
        FOREIGN KEY (job_id)
        REFERENCES jobs(id)
        ON DELETE CASCADE
);

