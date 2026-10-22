import NewExperiment from "./NewExperiment";
import "./Dashboard.css";

import { useEffect, useState } from "react";
import {
    getProjects,
    getJobs,
    getDatasets,
    uploadDataset,
    createProject,
    getExperimentResults,
    getWorkers,
    getJobDetails,
    getJobExecutions,
    getJobLogs,
    getQueues,
    createQueue,
    pauseQueue,
    resumeQueue
} from "../api";


const navItems = [
    { name: "Overview", icon: "◫" },
    { name: "Datasets", icon: "▤" },
    { name: "Experiments", icon: "⚗" },
    { name: "Queues", icon: "☷" },
    { name: "Workers", icon: "▦" },
    { name: "Model Compare", icon: "⇄" }
];

export default function Dashboard({ user, onLogout }) {
    const [page, setPage] = useState("Overview");
    const [projects, setProjects] = useState([]);
    const [jobs, setJobs] = useState([]);
    const [datasets, setDatasets] = useState([]);
    const [projectId, setProjectId] = useState("");
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [showProjectForm, setShowProjectForm] = useState(false);
    const [showNewExperiment, setShowNewExperiment] = useState(false);
    const [projectName, setProjectName] = useState("");
    const [projectDescription, setProjectDescription] = useState("");
    const [creatingProject, setCreatingProject] = useState(false);
    const [experimentResults, setExperimentResults] = useState([]);
    const [workers, setWorkers] = useState([]);
    const [jobStatusFilter, setJobStatusFilter] = useState("all");
    const [selectedJob, setSelectedJob] = useState(null);
    const [jobExecutions, setJobExecutions] = useState([]);
    const [jobLogs, setJobLogs] = useState([]);
    const [jobDetailsLoading, setJobDetailsLoading] = useState(false);
    const [jobDetailsError, setJobDetailsError] = useState("");
    const [queues, setQueues] = useState([]);
    const [queuesLoading, setQueuesLoading] = useState(false);
    const [queueActionId, setQueueActionId] = useState(null);
    const [queueName, setQueueName] = useState("");
    const [queueConcurrency, setQueueConcurrency] = useState(2);
    const [queuePriority, setQueuePriority] = useState(1);
    const [queueMaxRetries, setQueueMaxRetries] = useState(3);
    const [creatingQueue, setCreatingQueue] = useState(false);
    const [showCreateQueue, setShowCreateQueue] = useState(false);

    async function handleCreateProject(e) {
        e.preventDefault();

        if (!projectName.trim()) {
            setMessage("Please enter a project name.");
            return;
        }
        setCreatingProject(true);
        setMessage("");
        setError("");

        try {
            await createProject({
                name: projectName.trim(),
                description: projectDescription.trim()
            });
            setMessage("Project created successfully!");
            setProjectName("");
            setProjectDescription("");
            setShowProjectForm(false);

            await loadData();
        } catch (err) {
            setMessage(
                err.response?.data?.error ||
                "Could not create project. Check the backend."
            );
        } finally {
            setCreatingProject(false);
        }
    }

    async function loadData() {
        setError("");

        try {
            const [projectRes, jobRes, datasetRes] = await Promise.all([
                getProjects(),
                getJobs(),
                getDatasets()
            ]);

            setProjects(Array.isArray(projectRes.data) ? projectRes.data : []);
            setJobs(Array.isArray(jobRes.data) ? jobRes.data : []);
            setDatasets(Array.isArray(datasetRes.data) ? datasetRes.data : []);

            if (Array.isArray(projectRes.data) && projectRes.data.length > 0) {
                setProjectId((old) => {
                    const exists = projectRes.data.some(
                        (project) => String(project.id) === String(old)
                    );
                    return exists ? old : String(projectRes.data[0].id);
                });
            } else {
                setProjectId("");
                setQueues([]);
            }

            // Optional dashboard sections should not block core data.
            const [resultsRes, workersRes] = await Promise.allSettled([
                getExperimentResults(),
                getWorkers()
            ]);

            if (resultsRes.status === "fulfilled") {
                setExperimentResults(
                    Array.isArray(resultsRes.value.data)
                        ? resultsRes.value.data
                        : []
                );
            } else {
                console.error("Could not load experiment results:", resultsRes.reason);
                setError("Projects and jobs loaded, but model results could not be loaded.");
            }

            if (workersRes.status === "fulfilled") {
                setWorkers(
                    Array.isArray(workersRes.value.data)
                        ? workersRes.value.data
                        : []
                );
            } else {
                console.error("Could not load workers:", workersRes.reason);
                setWorkers([]);
            }
        } catch (err) {
        console.error("Dashboard loading failed:", {
            url: err.config?.url,
            status: err.response?.status,
            response: err.response?.data,
            message: err.message,
        });

        setError(
            err.response?.data?.error ||
            err.response?.data?.message ||
            `Dashboard request failed${
            err.response?.status
                ? ` (${err.response.status})`
                : ""
            }. Check the browser console.`
        );
        } finally {
        setLoading(false);
        }
    }

    async function handleViewJob(jobId) {
        setSelectedJob(null);
        setJobExecutions([]);
        setJobLogs([]);
        setJobDetailsError("");
        setJobDetailsLoading(true);

        try {
            const [detailsRes, executionsRes, logsRes] = await Promise.all([
                getJobDetails(jobId),
                getJobExecutions(jobId),
                getJobLogs(jobId)
            ]);

            setSelectedJob(detailsRes.data);
            setJobExecutions(
                Array.isArray(executionsRes.data) ? executionsRes.data : []
            );
            setJobLogs(
                Array.isArray(logsRes.data) ? logsRes.data : []
            );
        } catch (err) {
            setJobDetailsError(
                err.response?.data?.error ||
                "Could not load this job's details."
            );
        } finally {
            setJobDetailsLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);


    async function handleUpload(e) {
        e.preventDefault();
        if (!file || !projectId) {
            setMessage("Choose a project and a CSV file.");
            return;
        }

        setUploading(true);
        setMessage("");

        try {
            await uploadDataset(file, projectId);
            setMessage("Dataset uploaded successfully.");
            setFile(null);
            e.target.reset();
            await loadData();
        } catch (err) {
            setMessage(
                err.response?.data?.error ||
                "Upload failed. Check the API route and backend logs."
            );
        } finally {
            setUploading(false);
        }
    }
    
    const completed = jobs.filter(
        (j) => j.status === "completed"
    ).length;

    const running = jobs.filter(
        (j) => j.status === "running" || j.status === "claimed"
    ).length;

    const failed = jobs.filter(
        (j) => j.status === "failed" || j.status === "dead"
    ).length;

    const filteredJobs = jobs.filter((job) =>
        jobStatusFilter === "all" || job.status === jobStatusFilter
    );

    function statusClass(status) {
        if (["completed", "online"].includes(status)) return "success";
        if (["running", "claimed"].includes(status)) return "running";
        if (["failed", "dead"].includes(status)) return "failed";
        return "pending";
    }

    function readMetrics(result) {
        try {
            const value =
                typeof result.metrics === "string"
                    ? JSON.parse(result.metrics)
                    : result.metrics;

            return value && typeof value === "object" ? value : {};
        } catch {
            return {};
        }
    }

    function metricValue(result, key) {
        const metrics = readMetrics(result);

        const aliases = {
            accuracy: ["accuracy"],
            precision: ["precision"],
            recall: ["recall"],
            f1_score: ["f1_score", "f1", "f1-score"]
        };

        const value = (aliases[key] || [key])
            .map((name) => metrics[name])
            .find((item) => item !== undefined && item !== null && item !== "");

        if (value === undefined) return null;

        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function displayMetric(value) {
        if (value === null || value === undefined || value === "") {
            return "—";
        }

        const number = Number(value);

        if (!Number.isFinite(number) || number < 0) {
            return "—";
        }

        // Support either fractions (0.95) or percentages (95).
        const percentage = number <= 1 ? number * 100 : number;

        return `${percentage.toFixed(2)}%`;
    }

    const rankedResults = experimentResults
        .map((result) => ({
            ...result,
            comparisonF1: metricValue(result, "f1_score")
        }))
        .sort((a, b) => {
            if (a.comparisonF1 === null) return 1;
            if (b.comparisonF1 === null) return -1;
            return b.comparisonF1 - a.comparisonF1;
        });

    const bestModel =
        rankedResults.find((result) => result.comparisonF1 !== null) || null;

    async function loadQueues() {
        if (!projectId) {
            setQueues([]);
            return;
        }

        setQueuesLoading(true);

        try {
            const response = await getQueues(projectId);
            setQueues(Array.isArray(response.data) ? response.data : []);
        } catch (err) {
            setMessage(
                err.response?.data?.error || "Could not load queues."
            );
            setQueues([]);
        } finally {
            setQueuesLoading(false);
        }
    }

    async function handleCreateQueue(e) {
        e.preventDefault();

        if (!projectId) {
            setMessage("Create or select a project first.");
            return;
        }

        if (!queueName.trim()) {
            setMessage("Enter a queue name.");
            return;
        }

        setCreatingQueue(true);
        setMessage("");
        setError("");

        try {
            await createQueue({
                project_id: Number(projectId),
                name: queueName.trim(),
                priority: Number(queuePriority),
                concurrency_limit: Number(queueConcurrency),
                max_retries: Number(queueMaxRetries),
                retry_strategy: "fixed",
                retry_delay: 5
            });

            setMessage("Queue created successfully!");
            setQueueName("");
            setShowCreateQueue(false);
            await loadQueues();
        } catch (err) {
            setMessage(
                err.response?.data?.error || "Could not create queue."
            );
        } finally {
            setCreatingQueue(false);
        }
    }

    async function handleQueueAction(queue) {
        setQueueActionId(queue.id);
        setMessage("");

        try {
            if (Number(queue.is_paused) === 1 || queue.is_paused === true) {
                await resumeQueue(queue.id);
                setMessage(`Queue "${queue.name}" resumed.`);
            } else {
                await pauseQueue(queue.id);
                setMessage(`Queue "${queue.name}" paused.`);
            }

            await loadQueues();
        } catch (err) {
            setMessage(
                err.response?.data?.error || "Could not update the queue."
            );
        } finally {
            setQueueActionId(null);
        }
    } 

    useEffect(() => {
        if (page === "Queues" && projectId) {
            loadQueues();
        }
    }, [page, projectId]);

    return (
        <div className="ml-app">
            <aside className="ml-sidebar">
                <div className="ml-brand">
                    <div className="ml-brand-icon">M</div>
                    <div>
                        <h2>MLLab</h2>
                        <span>ML WORKSPACE</span>
                    </div>
                </div>

                <div className="ml-nav-label">WORKSPACE</div>
                <nav className="ml-nav">
                    {navItems.map((item) => (
                        <button
                            key={item.name}
                            className={page === item.name ? "active" : ""}
                            onClick={() => {
                                setPage(item.name);
                                setMessage("");

                                if (
                                    item.name === "Experiments" ||
                                    item.name === "Model Compare" ||
                                    item.name === "Workers"
                                ) {
                                    loadData();
                                }

                                if (item.name === "Queues" && projectId) {
                                    loadQueues();
                                }

                                if (item.name !== "Experiments") {
                                    setShowNewExperiment(false);
                                }
                            }}
                        >
                            <span className="ml-nav-icon">{item.icon}</span>
                            {item.name}
                            {item.name === "Datasets" && datasets.length > 0 && (
                                <span className="ml-nav-count">
                                    {datasets.length}
                                </span>
                            )}
                        </button>
                    ))}
                </nav>

                <div className="ml-sidebar-bottom">
                    <div className="ml-profile">
                        <div className="ml-avatar">
                            {(user?.name || "U").charAt(0).toUpperCase()}
                        </div>
                        <div className="ml-profile-info">
                            <strong>{user?.name || "User"}</strong>
                            <span>{user?.email || "MLLab account"}</span>
                        </div>
                    </div>
                    <button className="ml-logout" onClick={onLogout}>
                        ↪ Sign out
                    </button>
                </div>
            </aside>

            <main className="ml-main">
                <header className="ml-topbar">
                    <div className="ml-breadcrumb">
                        Workspace <span>/</span> <strong>{page}</strong>
                    </div>
                    <div className="ml-top-actions">
                        <span className="ml-live-dot" />
                        <span>Local environment</span>
                        <button
                            className="ml-refresh"
                            onClick={loadData}
                            title="Refresh data"
                        >
                            ↻
                        </button>
                    </div>
                </header>

                <div className="ml-content">
                    <div className="ml-heading-row">
                        <div>
                            <div className="ml-eyebrow">MACHINE LEARNING PLATFORM</div>
                            <h1>{page === "Overview" ? "Welcome back" : page}</h1>
                            <p>
                                {page === "Overview"
                                    ? "Manage datasets and monitor your ML workload."
                                    : `Manage your ${page.toLowerCase()} in one place.`}
                            </p>
                        </div>

                        {page === "Experiments" && (
                            <div className="ml-heading-actions">
                                <button
                                    className="ml-primary-btn"
                                    onClick={() => setShowNewExperiment((old) => !old)}
                                >
                                    {showNewExperiment ? "Close form" : "+ New Experiment"}
                                </button>
                            </div>
                        )}

                        {page === "Datasets" && (
                            <div className="ml-heading-actions">
                                <button
                                    className="ml-secondary-btn"
                                    onClick={() => {
                                        setShowProjectForm((old) => !old);
                                        setMessage("");
                                    }}
                                >
                                    + Create Project
                                </button>

                                <button
                                    className="ml-primary-btn"
                                    onClick={() =>
                                        document.getElementById("ml-upload")?.scrollIntoView({
                                            behavior: "smooth"
                                        })
                                    }
                                >
                                    + Upload dataset
                                </button>
                            </div>
                        )}
                    </div>

                    {error && <div className="ml-alert">{error}</div>}

                    {loading ? (
                        <div className="ml-panel ml-loading">
                            Loading your workspace...
                        </div>
                    ) : (
                        <>
                            {page === "Overview" && (
                                <>
                                    <div className="ml-stats">
                                        <StatCard
                                            label="Total datasets"
                                            value={datasets.length}
                                            icon="▤"
                                            note="Uploaded CSV files"
                                            color="blue"
                                        />
                                        <StatCard
                                            label="Total experiments"
                                            value={jobs.length}
                                            icon="⚗"
                                            note="Jobs in your workspace"
                                            color="purple"
                                        />
                                        <StatCard
                                            label="Completed runs"
                                            value={completed}
                                            icon="✓"
                                            note="Successfully finished"
                                            color="green"
                                        />
                                        <StatCard
                                            label="Active jobs"
                                            value={running}
                                            icon="◷"
                                            note="Currently processing"
                                            color="orange"
                                        />
                                    </div>

                                    <div className="ml-two-columns">
                                        <section className="ml-panel">
                                            <div className="ml-panel-heading">
                                                <div>
                                                    <h3>Recent experiments</h3>
                                                    <p>Your latest job activity</p>
                                                </div>
                                                <button
                                                    className="ml-text-btn"
                                                    onClick={() => setPage("Experiments")}
                                                >
                                                    View all →
                                                </button>
                                            </div>
                                            <JobTable jobs={jobs.slice(0, 6)} onViewJob={handleViewJob} />
                                        </section>

                                        <section className="ml-panel">
                                            <div className="ml-panel-heading">
                                                <div>
                                                    <h3>Workspace summary</h3>
                                                    <p>Current resource overview</p>
                                                </div>
                                            </div>
                                            <SummaryRow label="Projects" value={projects.length} />
                                            <SummaryRow label="Datasets" value={datasets.length} />
                                            <SummaryRow label="Completed" value={completed} />
                                            <SummaryRow label="Running" value={running} />
                                            <SummaryRow label="Failed" value={failed} />
                                            <div className="ml-info-box">
                                                <strong>Ready for your next experiment?</strong>
                                                <p>Upload a CSV dataset to get started.</p>
                                                <button
                                                    className="ml-primary-btn"
                                                    onClick={() => setPage("Datasets")}
                                                >
                                                    Open datasets →
                                                </button>
                                            </div>
                                        </section>
                                    </div>
                                </>
                            )}

                            {page === "Datasets" && showProjectForm && (
                                <section className="ml-panel ml-project-form-panel">
                                    <div className="ml-panel-heading">
                                        <div>
                                            <h3>Create a project</h3>
                                            <p>Organize datasets and machine learning experiments.</p>
                                        </div>
                                    </div>

                                    <form
                                        className="ml-upload-form"
                                        onSubmit={handleCreateProject}
                                    >
                                        <label htmlFor="project-name">Project name</label>
                                        <input
                                            id="project-name"
                                            type="text"
                                            value={projectName}
                                            onChange={(e) => setProjectName(e.target.value)}
                                            placeholder="e.g. Student Performance Prediction"
                                            maxLength={150}
                                            required
                                        />

                                        <label htmlFor="project-description">Description (optional)</label>
                                        <textarea
                                            id="project-description"
                                            value={projectDescription}
                                            onChange={(e) => setProjectDescription(e.target.value)}
                                            placeholder="Describe your machine learning project"
                                            rows={3}
                                        />

                                        <div className="ml-heading-actions">
                                            <button
                                                type="submit"
                                                className="ml-primary-btn"
                                                disabled={creatingProject}
                                            >
                                                {creatingProject ? "Creating..." : "Create Project"}
                                            </button>

                                            <button
                                                type="button"
                                                className="ml-secondary-btn"
                                                onClick={() => setShowProjectForm(false)}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </form>
                                </section>
                            )}
                            {page === "Datasets" && (
                                <div className="ml-two-columns ml-dataset-layout">
                                    <section className="ml-panel">
                                        <div className="ml-panel-heading">
                                            <div>
                                                <h3>Your datasets</h3>
                                                <p>{datasets.length} uploaded file(s)</p>
                                            </div>
                                        </div>
                                        {datasets.length === 0 ? (
                                            <EmptyState
                                                title="No datasets yet"
                                                description="Upload your first CSV file using the form."
                                            />
                                        ) : (
                                            <div className="ml-dataset-list">
                                                {datasets.map((d) => (
                                                    <div className="ml-dataset-item" key={d.id}>
                                                        <div className="ml-file-icon">CSV</div>
                                                        <div className="ml-dataset-details">
                                                            <strong>{d.original_filename || d.filename || `Dataset ${d.id}`}</strong>
                                                            <span>
                                                                {d.row_count ?? "—"} rows ·{" "}
                                                                {Array.isArray(d.columns)
                                                                    ? d.columns.length
                                                                    : "—"} columns
                                                            </span>
                                                        </div>
                                                        <span className="ml-status success">
                                                            Uploaded
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </section>

                                    <section className="ml-panel" id="ml-upload">
                                        <div className="ml-panel-heading">
                                            <div>
                                                <h3>Upload dataset</h3>
                                                <p>Choose a project and a CSV file</p>
                                            </div>
                                        </div>
                                        <form onSubmit={handleUpload} className="ml-upload-form">
                                            <label>Project</label>
                                            <select
                                                value={projectId}
                                                onChange={(e) => setProjectId(e.target.value)}
                                                required
                                            >
                                                <option value="">Select project</option>
                                                {projects.map((p) => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.name}
                                                    </option>
                                                ))}
                                            </select>

                                            <label>CSV file</label>
                                            <div className="ml-dropzone">
                                                <div className="ml-upload-symbol">↑</div>
                                                <strong>
                                                    {file ? file.name : "Choose a CSV dataset"}
                                                </strong>
                                                <span>CSV format · Maximum 20 MB</span>
                                                <input
                                                    type="file"
                                                    accept=".csv,text/csv"
                                                    onChange={(e) =>
                                                        setFile(e.target.files?.[0] || null)
                                                    }
                                                    required
                                                />
                                            </div>
                                            <button
                                                className="ml-primary-btn ml-full-btn"
                                                disabled={uploading || !projects.length}
                                            >
                                                {uploading ? "Uploading..." : "Upload dataset"}
                                            </button>
                                            {!projects.length && (
                                                <p className="ml-help">
                                                    Create a project before uploading a dataset.
                                                </p>
                                            )}
                                            {message && (
                                                <p className="ml-message">{message}</p>
                                            )}
                                        </form>
                                    </section>
                                </div>
                            )}

                            
                            {(page === "Overview" || page === "Experiments") && (
                                <section className="ml-panel">
                                    <div className="ml-panel-heading">
                                        <div>
                                            <h3>
                                                {page === "Overview"
                                                    ? "Recent activity"
                                                    : "Experiment runs"}
                                            </h3>
                                            <p>
                                                {filteredJobs.length} of {jobs.length} job(s) shown
                                            </p>
                                        </div>

                                        <div className="ml-heading-actions">
                                            <select
                                                className="ml-job-filter"
                                                value={jobStatusFilter}
                                                onChange={(e) => setJobStatusFilter(e.target.value)}
                                                aria-label="Filter jobs by status"
                                            >
                                                <option value="all">All statuses</option>
                                                <option value="queued">Queued</option>
                                                <option value="scheduled">Scheduled</option>
                                                <option value="claimed">Claimed</option>
                                                <option value="running">Running</option>
                                                <option value="retrying">Retrying</option>
                                                <option value="completed">Completed</option>
                                                <option value="failed">Failed</option>
                                                <option value="dead">Dead</option>
                                            </select>
                                        </div>
                                    </div>

                                    <JobTable
                                        jobs={filteredJobs}
                                        onViewJob={handleViewJob}
                                    />

                                    {(jobDetailsLoading || jobDetailsError || selectedJob) && (
                                        <section className="ml-job-details">
                                            <div className="ml-panel-heading">
                                                <div>
                                                    <h3>Job execution details</h3>
                                                    <p>Inspect the job, its attempts, and execution logs.</p>
                                                </div>

                                                <button
                                                    type="button"
                                                    className="ml-secondary-btn"
                                                    onClick={() => {
                                                        setSelectedJob(null);
                                                        setJobExecutions([]);
                                                        setJobLogs([]);
                                                        setJobDetailsError("");
                                                    }}
                                                >
                                                    Close
                                                </button>
                                            </div>

                                            {jobDetailsLoading && (
                                                <p className="ml-details-message">
                                                    Loading job details, attempts, and logs...
                                                </p>
                                            )}

                                            {jobDetailsError && (
                                                <p className="ml-details-error">
                                                    {jobDetailsError}
                                                </p>
                                            )}

                                            {selectedJob && !jobDetailsLoading && (
                                                <>
                                                    <div className="ml-job-detail-grid">
                                                        <div>
                                                            <span>Job name</span>
                                                            <strong>
                                                                {selectedJob.name || `Job #${selectedJob.id}`}
                                                            </strong>
                                                        </div>

                                                        <div>
                                                            <span>Job ID</span>
                                                            <strong>{selectedJob.id}</strong>
                                                        </div>

                                                        <div>
                                                            <span>Status</span>
                                                            <strong>
                                                                <span className={`ml-status ${statusClass(selectedJob.status)}`}>
                                                                    {selectedJob.status}
                                                                </span>
                                                            </strong>
                                                        </div>

                                                        <div>
                                                            <span>Attempts used</span>
                                                            <strong>
                                                                {selectedJob.attempts ?? 0} / {selectedJob.max_retries ?? 0}
                                                            </strong>
                                                        </div>

                                                        <div>
                                                            <span>Created</span>
                                                            <strong>
                                                                {selectedJob.created_at
                                                                    ? new Date(selectedJob.created_at).toLocaleString()
                                                                    : "—"}
                                                            </strong>
                                                        </div>

                                                        <div>
                                                            <span>Next scheduled run</span>
                                                            <strong>
                                                                {selectedJob.run_at
                                                                    ? new Date(selectedJob.run_at).toLocaleString()
                                                                    : "—"}
                                                            </strong>
                                                        </div>
                                                    </div>

                                                    <h4 className="ml-details-heading">
                                                        Execution history ({jobExecutions.length})
                                                    </h4>

                                                    {jobExecutions.length === 0 ? (
                                                        <p className="ml-details-message">
                                                            No execution attempts recorded yet.
                                                        </p>
                                                    ) : (
                                                        <div className="ml-table-wrap">
                                                            <table className="ml-table">
                                                                <thead>
                                                                    <tr>
                                                                        <th>Attempt</th>
                                                                        <th>Worker ID</th>
                                                                        <th>Status</th>
                                                                        <th>Started</th>
                                                                        <th>Finished</th>
                                                                        <th>Error</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {jobExecutions.map((execution) => (
                                                                        <tr key={execution.id}>
                                                                            <td>{execution.attempt}</td>
                                                                            <td>{execution.worker_id ?? "—"}</td>
                                                                            <td>
                                                                                <span className={`ml-status ${statusClass(execution.status)}`}>
                                                                                    {execution.status}
                                                                                </span>
                                                                            </td>
                                                                            <td className="ml-date">
                                                                                {execution.started_at
                                                                                    ? new Date(execution.started_at).toLocaleString()
                                                                                    : "—"}
                                                                            </td>
                                                                            <td className="ml-date">
                                                                                {execution.finished_at
                                                                                    ? new Date(execution.finished_at).toLocaleString()
                                                                                    : "—"}
                                                                            </td>
                                                                            <td className="ml-error-cell">
                                                                                {execution.error_message || "—"}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}

                                                    <h4 className="ml-details-heading">
                                                        Execution logs ({jobLogs.length})
                                                    </h4>

                                                    {jobLogs.length === 0 ? (
                                                        <p className="ml-details-message">
                                                            No logs recorded for this job.
                                                        </p>
                                                    ) : (
                                                        <div className="ml-log-list">
                                                            {jobLogs.map((log) => (
                                                                <div className="ml-log-entry" key={log.id}>
                                                                    <span className={`ml-log-level ${String(log.level).toLowerCase()}`}>
                                                                        {log.level}
                                                                    </span>
                                                                    <span className="ml-log-time">
                                                                        {log.created_at
                                                                            ? new Date(log.created_at).toLocaleString()
                                                                            : "—"}
                                                                    </span>
                                                                    <p>{log.message}</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </section>
                                    )}
                                </section>
                            )}


                            {page === "Model Compare" && (
                                <section className="ml-panel">
                                    <div className="ml-panel-heading">
                                        <div>
                                            <h3>Model comparison</h3>
                                            <p>
                                                Compare completed training runs using their saved evaluation metrics.
                                            </p>
                                        </div>
                                    </div>

                                    {bestModel && (
                                        <div className="ml-best-model">
                                            <div className="ml-best-model-info">
                                                <span className="ml-best-label">TOP F1-SCORE</span>
                                                <h3>{bestModel.algorithm || "Unknown algorithm"}</h3>
                                                <p>
                                                    {bestModel.job_name || `Job #${bestModel.job_id}`}
                                                    {" · Target: "}
                                                    {bestModel.target_column || "Not specified"}
                                                </p>
                                            </div>

                                            <div className="ml-best-score">
                                                {displayMetric(bestModel.comparisonF1)}
                                            </div>
                                        </div>
                                    )}

                                    {rankedResults.length === 0 ? (
                                        <EmptyState
                                            title="No model results available"
                                            description="Run an ML training experiment and refresh this page to see its evaluation metrics."
                                        />
                                    ) : (
                                        <div className="ml-table-wrap">
                                            <table className="ml-table">
                                                <thead>
                                                    <tr>
                                                        <th>Rank</th>
                                                        <th>Experiment</th>
                                                        <th>Algorithm</th>
                                                        <th>Target column</th>
                                                        <th>Accuracy</th>
                                                        <th>Precision</th>
                                                        <th>Recall</th>
                                                        <th>F1-score</th>
                                                    </tr>
                                                </thead>

                                                <tbody>
                                                    {rankedResults.map((result, index) => {
                                                        const isBest =
                                                            bestModel !== null &&
                                                            result.id === bestModel.id;

                                                        return (
                                                            <tr
                                                                key={result.id ?? result.job_id}
                                                                className={isBest ? "ml-best-row" : ""}
                                                            >
                                                                <td>
                                                                    {result.comparisonF1 === null
                                                                        ? "—"
                                                                        : `#${index + 1}`}
                                                                </td>

                                                                <td>
                                                                    {result.job_name ||
                                                                        `Job #${result.job_id}`}

                                                                    {isBest && (
                                                                        <span className="ml-best-tag">
                                                                            Best
                                                                        </span>
                                                                    )}
                                                                </td>

                                                                <td>{result.algorithm || "—"}</td>
                                                                <td>{result.target_column || "—"}</td>

                                                                <td>
                                                                    {displayMetric(
                                                                        metricValue(result, "accuracy")
                                                                    )}
                                                                </td>

                                                                <td>
                                                                    {displayMetric(
                                                                        metricValue(result, "precision")
                                                                    )}
                                                                </td>

                                                                <td>
                                                                    {displayMetric(
                                                                        metricValue(result, "recall")
                                                                    )}
                                                                </td>

                                                                <td>
                                                                    <strong>
                                                                        {displayMetric(result.comparisonF1)}
                                                                    </strong>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    <p className="ml-comparison-note">
                                        Ranking uses F1-score. Compare models only when they use compatible
                                        datasets, targets and evaluation methods.
                                    </p>
                                </section>
                            )}

                            {page === "Workers" && (
                                <section className="ml-panel">
                                    <div className="ml-panel-heading">
                                        <div>
                                            <h3>Distributed workers</h3>
                                            <p>Monitor worker availability and job execution.</p>
                                        </div>
                                    </div>

                                    {workers.length === 0 ? (
                                        <EmptyState
                                            title="No workers registered"
                                            description="Start your backend worker process to register a worker and begin processing queued jobs."
                                        />
                                    ) : (
                                        <div className="ml-table-wrap">
                                            <table className="ml-table">
                                                <thead>
                                                    <tr>
                                                        <th>Worker</th>
                                                        <th>Status</th>
                                                        <th>Current job</th>
                                                        <th>Completed</th>
                                                        <th>Failed</th>
                                                        <th>Last heartbeat</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {workers.map((worker) => (
                                                        <tr key={worker.id}>
                                                            <td>
                                                                <strong>{worker.name}</strong>
                                                                <div className="ml-date">
                                                                    ID: {worker.id}
                                                                </div>
                                                            </td>
                                                            <td>
                                                                <span
                                                                    className={`ml-status ${
                                                                        worker.status === "online"
                                                                            ? "success"
                                                                            : "failed"
                                                                    }`}
                                                                >
                                                                    {worker.status || "unknown"}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                {worker.current_job_id
                                                                    ? `${worker.current_job_name || "Job"} (#${worker.current_job_id})`
                                                                    : "Idle"}
                                                            </td>
                                                            <td>{worker.completed_jobs ?? 0}</td>
                                                            <td>{worker.failed_jobs ?? 0}</td>
                                                            <td className="ml-date">
                                                                {worker.last_heartbeat
                                                                    ? new Date(
                                                                        worker.last_heartbeat
                                                                    ).toLocaleString()
                                                                    : "Never"}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </section>
                            )}

                            
                            {page === "Queues" && (
                                <section className="ml-panel">
                                    <div className="ml-panel-heading">
                                        <div>
                                            <h3>Queue management</h3>
                                            <p>
                                                Monitor concurrency settings and control which queues
                                                can accept new jobs.
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            className="ml-create-queue-btn"
                                            onClick={() => setShowCreateQueue((prev) => !prev)}
                                        >
                                            + Create Queue
                                        </button>
                                    </div>

                                    <div className="ml-upload-form">
                                        <label htmlFor="queue-project">Project</label>
                                        <select
                                            id="queue-project"
                                            value={projectId}
                                            onChange={(e) => {
                                                setProjectId(e.target.value);
                                            }}
                                        >
                                            <option value="">Select project</option>
                                            {projects.map((project) => (
                                                <option key={project.id} value={project.id}>
                                                    {project.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {message && <p className="ml-message">{message}</p>}

                                    {queuesLoading ? (
                                        <p className="ml-help">Loading queues...</p>
                                    ) : !projectId ? (
                                        <EmptyState
                                            title="Select a project"
                                            description="Choose a project to view its queues."
                                        />
                                    ) : queues.length === 0 ? (
                                        <EmptyState
                                            title="No queues found"
                                            description="Create a queue for this project before submitting jobs."
                                        />
                                    ) : (
                                        <div className="ml-table-wrap">
                                            <table className="ml-table">
                                                <thead>
                                                    <tr>
                                                        <th>Queue</th>
                                                        <th>Concurrency limit</th>
                                                        <th>Status</th>
                                                        <th>Action</th>
                                                    </tr>
                                                </thead>

                                                <tbody>
                                                    {queues.map((queue) => {
                                                        const paused =
                                                            Number(queue.is_paused) === 1 ||
                                                            queue.is_paused === true;

                                                        return (
                                                            <tr key={queue.id}>
                                                                <td>
                                                                    <strong>{queue.name}</strong>
                                                                    <div className="ml-date">
                                                                        Queue ID: {queue.id}
                                                                    </div>
                                                                </td>

                                                                <td>
                                                                    {queue.concurrency_limit ?? 1}
                                                                </td>

                                                                <td>
                                                                    <span
                                                                        className={`ml-status ${
                                                                            paused ? "failed" : "success"
                                                                        }`}
                                                                    >
                                                                        {paused ? "Paused" : "Active"}
                                                                    </span>
                                                                </td>

                                                                <td>
                                                                    <button
                                                                        className={
                                                                            paused
                                                                                ? "ml-primary-btn"
                                                                                : "ml-secondary-btn"
                                                                        }
                                                                        disabled={queueActionId === queue.id}
                                                                        onClick={() =>
                                                                            handleQueueAction(queue)
                                                                        }
                                                                    >
                                                                        {queueActionId === queue.id
                                                                            ? "Updating..."
                                                                            : paused
                                                                                ? "Resume"
                                                                                : "Pause"}
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </section>
                            )}

                            {page === "Queues" && showCreateQueue && (
                                <div className="ml-two-columns">
                                    <section className="ml-panel">
                                        <div className="ml-panel-heading">
                                            <div>
                                                <h3>Create a queue</h3>
                                                <p>Configure how jobs are processed for a project.</p>
                                            </div>
                                        </div>
                                    </section>

                                    {message && <p className="ml-message">{message}</p>}
                                    {error && <p className="ml-message">{error}</p>}
                                </div>
                            )}


                            {page === "Experiments" && showNewExperiment && (
                                <NewExperiment
                                    onExperimentSubmitted={async () => {
                                        await loadData();
                                        setShowNewExperiment(false);
                                    }}
                                />
                            )}
                        </>
                    )}

                    <footer className="ml-footer">
                        MLLab · Distributed ML Training and Evaluation Platform
                    </footer>
                </div>
            </main>
        </div>
    );
}

function StatCard({ label, value, icon, note, color }) {
    return (
        <div className="ml-stat-card">
            <div className={`ml-stat-icon ${color}`}>{icon}</div>
            <span className="ml-stat-label">{label}</span>
            <strong className="ml-stat-value">{value}</strong>
            <span className="ml-stat-note">{note}</span>
        </div>
    );
}

function SummaryRow({ label, value }) {
    return (
        <div className="ml-summary-row">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function JobTable({ jobs, onViewJob }) {
    if (!jobs.length) {
        return (
            <EmptyState
                title="No experiments to show"
                description="Jobs will appear here when they are created."
            />
        );
    }

    return (
        <div className="ml-table-wrap">
            <table className="ml-table">
                <thead>
                    <tr>
                        <th>Experiment / Job</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {jobs.map((job) => (
                        <tr key={job.id}>
                            <td>
                                <div className="ml-job-name">
                                    <span className="ml-job-icon">⚗</span>
                                    <div>
                                        <strong>{job.name || `Job #${job.id}`}</strong>
                                        <span>Job ID: {job.id}</span>
                                    </div>
                                </div>
                            </td>
                            <td>
                                <span className={`ml-status ${job.status === "completed" ? "success" : ["running", "claimed"].includes(job.status) ? "running" : ["failed", "dead"].includes(job.status) ? "failed" : "pending"}`}>
                                    {job.status || "unknown"}
                                </span>
                            </td>
                            <td className="ml-date">
                                {job.created_at
                                    ? new Date(job.created_at).toLocaleDateString()
                                    : "—"}
                            </td>
                            <td>
                                <button
                                    type="button"
                                    className="ml-view-job-btn"
                                    onClick={() => onViewJob?.(job.id)}
                                >
                                    View details →
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function EmptyState({ title, description }) {
    return (
        <div className="ml-empty">
            <div className="ml-empty-icon">▤</div>
            <strong>{title}</strong>
            <p>{description}</p>
        </div>
    );
}

