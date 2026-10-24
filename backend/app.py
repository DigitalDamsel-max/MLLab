from flask import Flask
from flask_cors import CORS
from routes import routes

app = Flask(__name__)

CORS(app, resources={
        r"/api/*": {
            "origins": [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "https://ml-lab-teal.vercel.app"
            ]
        }
    },
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"]
)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024

app.register_blueprint(routes, url_prefix="/api")

@app.route("/")
def home():
    return {"message": "Distributed Job Scheduler backend is running"}, 200


if __name__ == "__main__":
    print("\nREGISTERED ROUTES:")
    for rule in app.url_map.iter_rules():
        print(rule, rule.methods)
    print()

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )