
import uuid, joblib
from pathlib import Path
import pandas as pd

from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
)
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.ensemble import RandomForestRegressor
from sklearn.tree import DecisionTreeRegressor
from sklearn.linear_model import LinearRegression


ALGORITHMS = {
    "Logistic Regression": LogisticRegression(max_iter=1000),
    "Decision Tree": DecisionTreeClassifier(random_state=42),
    "Random Forest": RandomForestClassifier(
        n_estimators=100, random_state=42
    ),
    "K-Nearest Neighbors": KNeighborsClassifier(n_neighbors=5),
}

REGRESSION_ALGORITHMS = {
    "Linear Regression": LinearRegression(),
    "Decision Tree Regressor": DecisionTreeRegressor(random_state=42),
    "Random Forest Regressor": RandomForestRegressor(
        n_estimators=100, random_state=42
    ),
}


def train_experiment(payload, execution_id=None):
    """
    Train a model for an MLLab job.
    Returns the evaluation metrics and saved model path.
    """

    dataset_id = payload.get("dataset_id")
    algorithm = payload.get("algorithm")
    target_column = payload.get("target_column")
    task_type = payload.get("task_type", "classification")

    if task_type not in {"classification", "regression"}:
        raise ValueError(
            "task_type must be 'classification' or 'regression'."
        )

    if not dataset_id or not algorithm or not target_column:
        raise ValueError(
            "Job payload must include dataset_id, algorithm and target_column."
        )

    # Look up the dataset path stored by the dataset-upload API.
    from db import get_db

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute(
            "SELECT file_path FROM datasets WHERE id = %s",
            (dataset_id,),
        )
        dataset = cursor.fetchone()
    finally:
        cursor.close()
        db.close()

    if not dataset:
        raise ValueError(f"Dataset {dataset_id} was not found.")

    upload_root = (Path(__file__).resolve().parent / "uploads" / "datasets").resolve()
    csv_path = Path(dataset["file_path"]).resolve()

    # Only allow files within the dataset upload directory.
    if upload_root not in csv_path.parents:
        raise ValueError("Dataset file path is outside the permitted upload folder.")

    if not csv_path.is_file() or csv_path.suffix.lower() != ".csv":
        raise ValueError("The uploaded CSV file could not be found.")

    df = pd.read_csv(csv_path)

    if df.empty:
        raise ValueError("The dataset contains no rows.")

    if target_column not in df.columns:
        raise ValueError(f"Target column '{target_column}' does not exist.")

    df = df.dropna(subset=[target_column])

    if len(df) < 5:
        raise ValueError("At least 5 usable rows are required for training.")

    X = df.drop(columns=[target_column])
    y = df[target_column]

    if X.shape[1] == 0:
        raise ValueError("The dataset needs at least one input feature.")

    if task_type == "regression":
        models = REGRESSION_ALGORITHMS
    else:
        models = ALGORITHMS

    if algorithm not in models:
        raise ValueError(
            f"Unsupported algorithm '{algorithm}' for {task_type}."
        )

    if task_type != "regression" and y.nunique() < 2:
        raise ValueError("Classification needs at least two target classes.")

    # Encode categorical target labels for classification.
    label_encoder = None
    if task_type != "regression" and not pd.api.types.is_numeric_dtype(y):
        label_encoder = LabelEncoder()
        y = pd.Series(label_encoder.fit_transform(y), index=y.index)

    numeric_columns = X.select_dtypes(include=["number"]).columns.tolist()
    categorical_columns = [
        col for col in X.columns if col not in numeric_columns
    ]

    numeric_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])

    categorical_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("encoder", OneHotEncoder(handle_unknown="ignore")),
    ])

    preprocess = ColumnTransformer([
        ("numeric", numeric_pipeline, numeric_columns),
        ("categorical", categorical_pipeline, categorical_columns),
    ])

    model = Pipeline([
        ("preprocessing", preprocess),
        ("model", models[algorithm]),
    ])

    stratify = None
    if task_type != "regression":
        class_counts = y.value_counts()
        if len(class_counts) > 1 and class_counts.min() >= 2:
            stratify = y

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=42,
        stratify=stratify,
    )

    model.fit(X_train, y_train)
    predictions = model.predict(X_test)

    if task_type == "regression":
        metrics = {
            "mae": round(float(mean_absolute_error(y_test, predictions)), 4),
            "mse": round(float(mean_squared_error(y_test, predictions)), 4),
            "r2": round(float(r2_score(y_test, predictions)), 4),
        }
    else:
        average = "weighted"
        metrics = {
            "accuracy": round(float(accuracy_score(y_test, predictions)), 4),
            "precision": round(float(precision_score(
                y_test, predictions, average=average, zero_division=0
            )), 4),
            "recall": round(float(recall_score(
                y_test, predictions, average=average, zero_division=0
            )), 4),
            "f1_score": round(float(f1_score(
                y_test, predictions, average=average, zero_division=0
            )), 4),
        }

    
    # Save each execution to a unique model file.
    model_id = uuid.uuid4().hex
    execution_suffix = str(execution_id) if execution_id is not None else model_id

    output_dir = Path(__file__).resolve().parent / "models_saved"
    output_dir.mkdir(parents=True, exist_ok=True)

    model_filename = f"model_dataset_{dataset_id}_execution_{execution_suffix}_{model_id}.joblib"
    model_path = output_dir / model_filename

    joblib.dump({
        "model": model,
        "task_type": task_type,
        "target_column": target_column,
        "label_encoder": label_encoder,
        "feature_columns": X.columns.tolist(),
    }, model_path)


    return {
        "algorithm": algorithm,
        "target_column": target_column,
        "task_type": task_type,
        "metrics": metrics,
        "model_path": str(model_path),
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
    }
