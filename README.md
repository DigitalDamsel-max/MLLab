# MLLab — ML Job Scheduler Dashboard 

MLLab is a web-based dashboard concept for managing machine-learning projects, datasets, experiments, queues, jobs, and workers. The supplied files provide the React frontend components and an Axios API client for communicating with a Flask backend.


** Features represented in the frontend **

Dashboard / Overview — a central view of project and job activity.
Datasets — dataset-related views and upload integration.
Experiments — experiment workflow and model-related controls.
Queues — view and manage project queues, including pause/resume and queue creation where supported by the backend.
Workers — view worker information returned by the backend.
Model Compare — compare experiment/model results where the backend supplies them.
Authentication API helpers — registration, login, and bearer-token handling.
Job API helpers — create jobs, retrieve details, executions and logs, and retry jobs.
The exact features available at runtime depend on the matching backend routes and data.


** Technology stack **

React (frontend components)
JavaScript and CSS
Axios for HTTP requests
Flask REST API 
MySQL
Dashboard.jsx — dashboard pages, navigation, and page interactions.
Dashboard.css — dashboard styling.
NewExperiment.jsx — experiment form component.
api.js — Axios client and API helper functions.
README.txt 
Requirements


** Setup **

1. Place the frontend files
Copy the supplied files into the appropriate locations in your existing React project. Keep the import paths consistent with your project structure. For example, api.js must be located where the imports in your React components expect it.

2. Install frontend dependencies
From the directory containing your full project's package.json, run:

npm install
If Axios is not already listed as a dependency, install it:

npm install axios
3. Start the Flask backend
Start your backend using its own setup instructions and ensure it exposes the endpoints used by api.js. The current API client uses:

http://127.0.0.1:5000/api
This address is for local development. Change it to your configured backend URL when needed. Do not put passwords, secret keys, or other credentials directly into source control.

4. Start the frontend
Use the script defined in your full project's package.json. A typical Vite project uses:

npm run dev
5. Configure the database, if applicable
If the full backend uses MySQL, include a reviewed database/schema.sql file in the repository. Document the database name and import steps here once they match the actual schema. Never commit production credentials or private user data.


** API endpoints referenced by api.js **

The frontend API helper currently references routes for:
Authentication: /register, /login
Projects: /projects
Queues: /queues, /queues/<project_id>, and queue pause/resume routes
Jobs: /jobs, job details, executions, logs, and retry
Datasets: /datasets and /datasets/upload
Experiment results: /experiment-results
Workers: /workers
