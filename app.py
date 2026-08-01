"""SLR Digital Safe Work Permit - WSGI Application.

This file is the main entry point for a production-grade server.
It uses Flask to handle web requests and calls the business logic
from the `server` module.

To run in production:
    pip install -r requirements.txt
    waitress-serve --host=0.0.0.0 --port=8081 app:app
"""

from __future__ import annotations

import json
from functools import wraps
from http import HTTPStatus
import click
from flask.cli import with_appcontext

from flask import Flask, Response, jsonify, request, send_from_directory

import server as logic


app = Flask(__name__, static_folder=None)
logic.init_db()


class AppError(Exception):
    """Custom exception class for the application."""
    def __init__(self, message: str, status: int = HTTPStatus.BAD_REQUEST):
        super().__init__(message)
        self.status = status


@app.errorhandler(AppError)
def handle_app_error(error: AppError) -> Response:
    """Catches custom AppError and returns a JSON response."""
    response = jsonify({"error": str(error)})
    response.status_code = error.status
    return response


@app.errorhandler(Exception)
def handle_generic_error(error: Exception) -> Response:
    """Catches any unhandled exceptions and returns a generic error."""
    app.logger.error("An unhandled exception occurred", exc_info=error)
    response = jsonify({"error": str(error)})
    response.status_code = HTTPStatus.INTERNAL_SERVER_ERROR
    return response

@app.cli.command("reset-db")
@click.confirmation_option(prompt="Are you sure you want to wipe the database? This will delete ALL permits, logs, and non-admin users.")
def reset_db_command():
    """Wipes all transactional data and non-admin users, resetting to a clean state."""
    try:
        logic.reset_database(AppError)
        click.echo("✅ Database has been successfully reset.")
    except AppError as e:
        click.echo(f"❌ Error: {e}", err=True)


def get_current_user(required: bool = True) -> logic.sqlite3.Row | None:
    """Gets the current user from the session token in the Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip() if auth_header.startswith("Bearer ") else ""
    return logic.get_user_from_session(token, required, AppError)


def admin_required(f):
    """Decorator to ensure the current user is an administrator."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if user["role"] != "admin":
            raise AppError("Only the administrator can approve this action.", HTTPStatus.FORBIDDEN)
        return f(user, *args, **kwargs)
    return decorated_function


# --- Static File Serving ---
@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def serve_static(path: str) -> Response:
    """Serves static files from the 'static' directory."""
    return send_from_directory(logic.STATIC_DIR, path)


# --- API Routes ---
@app.after_request
def add_security_headers(response: Response) -> Response:
    """Adds security headers to all API responses."""
    if "/api/" in request.path:
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
    if response.mimetype == "text/html":
        response.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    return response


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "time": logic.now()})


@app.route("/api/config", methods=["GET"])
def config():
    return jsonify({
        "departments": logic.DEPARTMENTS,
        "divisions": logic.DIVISIONS,
        "designations": logic.DESIGNATIONS,
        "vapidPublicKey": logic.VAPID_PUBLIC_KEY,
    })


@app.route("/api/auth/register", methods=["POST"])
def register():
    logic.register(request.get_json(), AppError)
    return jsonify({"message": "Your access request was sent to the administrator. You can sign in after approval."}), HTTPStatus.CREATED


@app.route("/api/auth/login", methods=["POST"])
def login():
    token, user = logic.login(request.get_json(), AppError)
    return jsonify({"token": token, "user": user})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip() if auth_header.startswith("Bearer ") else ""
    logic.logout(token)
    return jsonify({"ok": True})


@app.route("/api/auth/me", methods=["GET"])
def get_me():
    user = get_current_user()
    return jsonify({"user": logic.public_user(user)})


@app.route("/api/auth/change-password", methods=["POST"])
def change_password():
    user = get_current_user()
    logic.change_password(user, request.get_json(), AppError)
    return jsonify({"message": "Password changed successfully."})


@app.route("/api/dashboard", methods=["GET"])
def dashboard():
    logic.auto_close_expired_permits()
    user = get_current_user()
    dashboard_data = logic.get_dashboard_data(user)
    return jsonify(dashboard_data)


@app.route("/api/users/pending", methods=["GET"])
@admin_required
def get_users_for_admin(admin):
    users = logic.get_users_for_admin()
    return jsonify({"users": users})


@app.route("/api/users/<int:user_id>/approve", methods=["POST"])
@admin_required
def approve_user(admin, user_id: int):
    mobile_number = logic.approve_user(admin, user_id, request.get_json(), AppError)
    sms_sent = logic.send_sms(mobile_number, "Congrats! You are approved for work permit in SLR.")
    message = "User approved."
    if not sms_sent:
        message += " However, the notification SMS could not be sent."
    return jsonify({"message": message})


@app.route("/api/users/<int:user_id>/reject", methods=["POST"])
@admin_required
def reject_user(admin, user_id: int):
    logic.reject_user(admin, user_id, AppError)
    return jsonify({"message": "Access request rejected."})


@app.route("/api/users/<int:user_id>", methods=["DELETE"])
@admin_required
def delete_user(admin, user_id: int):
    logic.deactivate_user(admin, user_id, AppError)
    return jsonify({"message": "User account deactivated."})


@app.route("/api/permits", methods=["GET"])
def get_permits():
    logic.auto_close_expired_permits()
    user = get_current_user()
    permits = logic.get_permits(user)
    return jsonify({"permits": permits})


@app.route("/api/permits", methods=["POST"])
def create_permit():
    try:
        user = get_current_user()
        permit_id, permit_no = logic.create_permit(user, request.get_json(), AppError)
        with logic.db() as conn:
            status = conn.execute("SELECT status FROM permits WHERE id = ?", (permit_id,)).fetchone()['status']
        
        if status == 'pending_approval':
            message = f"{permit_no} submitted for final review."
        else:
            message = f"{permit_no} submitted for departmental approval."

        return jsonify({"message": message, "permitId": permit_id, "permitNo": permit_no}), HTTPStatus.CREATED
    except AppError as e:
        raise e
    except Exception as e:
        app.logger.error(f"Unhandled exception in create_permit: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected server error occurred: {e}"}), HTTPStatus.INTERNAL_SERVER_ERROR


@app.route("/api/permits/<int:permit_id>", methods=["GET"])
def get_permit_details(permit_id: int):
    logic.auto_close_expired_permits()
    user = get_current_user()
    permit, audit_log, approvals = logic.get_permit_details(user, permit_id, AppError)
    return jsonify({"permit": permit, "audit": audit_log, "approvals": approvals})

@app.route("/api/permits/actionable", methods=["GET"])
@admin_required
def get_actionable_permits(admin):
    logic.auto_close_expired_permits()
    permits = logic.get_actionable_permits()
    return jsonify({"permits": permits})


@app.route("/api/permits/<int:permit_id>/department-approve", methods=["POST"])
def department_approve_permit(permit_id: int):
    try:
        user = get_current_user()
        json_data = request.get_json()
        if not json_data:
            raise AppError("Invalid request body. JSON expected.")
        logic.department_approve_permit(user, permit_id, json_data, AppError)
        return jsonify({"message": "Permit approval status updated."})
    except AppError as e:
        raise e
    except Exception as e:
        app.logger.error(f"Unhandled exception in department_approve_permit for permit {permit_id}: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected server error occurred: {e}"}), HTTPStatus.INTERNAL_SERVER_ERROR
    

@app.route("/api/permits/<int:permit_id>/issue", methods=["POST"])
@admin_required
def issue_permit(admin, permit_id: int):
    message = logic.issue_permit(admin, permit_id, request.get_json(), AppError)
    return jsonify({"message": message})


@app.route("/api/permits/<int:permit_id>/complete", methods=["POST"])
def complete_permit(permit_id: int):
    user = get_current_user()
    logic.complete_permit(user, permit_id, request.get_json(), AppError)
    return jsonify({"message": "Job completion sent to the administrator for closure."})


@app.route("/api/permits/<int:permit_id>/close", methods=["POST"])
@admin_required
def close_permit(admin, permit_id: int):
    logic.close_permit(admin, permit_id, AppError)
    return jsonify({"message": "Permit closed."})


@app.route("/api/permits/<int:permit_id>", methods=["DELETE"])
@admin_required
def delete_permit(admin, permit_id: int):
    logic.delete_permit(admin, permit_id, AppError)
    return jsonify({"message": "Permit permanently deleted."})


@app.route("/api/notifications/subscribe", methods=["POST"])
def subscribe_notifications():
    user = get_current_user()
    subscription_data = request.get_json()
    if not subscription_data or "endpoint" not in subscription_data:
        raise AppError("Invalid subscription object.")
    logic.save_push_subscription(user["id"], subscription_data, AppError)
    return jsonify({"message": "Notifications enabled."}), HTTPStatus.CREATED


@app.route("/api/notifications/unsubscribe", methods=["POST"])
def unsubscribe_notifications():
    user = get_current_user()
    subscription_data = request.get_json()
    if not subscription_data or "endpoint" not in subscription_data:
        raise AppError("Invalid subscription object.")
    logic.delete_push_subscription(user["id"], subscription_data["endpoint"])
    return jsonify({"message": "Notifications disabled."})