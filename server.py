"""SLR Digital Safe Work Permit - Business Logic and Database Module.

This module contains all the core application logic, database interactions,
and helper functions. It is used by the `app.py` web application but
contains no web server code itself.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import base64
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse
import urllib.request
from pywebpush import webpush, WebPushException


ROOT = Path(__file__).resolve().parent

# --- Vercel Deployment Note ---
# Vercel has a read-only filesystem, except for the /tmp directory.
# We are placing the database there for the deployment to run.
# WARNING: The /tmp directory is ephemeral and will be cleared between
# serverless function invocations. This means your data WILL NOT PERSIST.
# This is for demonstration/testing only. For production, use a managed
# database service like Vercel Postgres.
IS_VERCEL = os.environ.get("VERCEL") == "1"
DATA_DIR = Path("/tmp/data") if IS_VERCEL else ROOT / "data"
DB_PATH = DATA_DIR / "work_permit.db"
STATIC_DIR = ROOT / "static"

DEPARTMENTS = ["Mechanical", "Operation", "Safety", "Electrician", "Fire Department"]
DIVISIONS = ["MBF 1", "MBF 2", "Sinter 1", "Sinter 2", "SMS", "CCM", "Rolling Mill"]
ROLES = ["requester", "issuer", "safety", "admin"]
PERMIT_STATUSES = ["pending_approval", "issued", "job_completed", "closed", "rejected"]
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_CLAIMS = {"sub": "mailto:admin@slr-metaliks.com"}


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def password_hash(password: str, salt: str | None = None) -> tuple[str, str]:
    if salt is None:
        salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 210_000)
    return salt, digest.hex()


def send_sms(number: str, message: str) -> bool:
    """Sends an SMS using a generic webhook if configured, otherwise prints to console."""
    webhook_url = os.environ.get("SMS_WEBHOOK_URL", "").strip()

    if webhook_url:
        try:
            payload = json.dumps({"to": number, "message": message}).encode("utf-8")
            request = urllib.request.Request(webhook_url, data=payload, method="POST", headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=10) as response:
                if response.status < 400:
                    return True
                print(f"[SMS ERROR] Webhook delivery failed with status {response.status}")
                return False
        except Exception as exc:
            print(f"[SMS ERROR] Webhook delivery failed: {exc}")
            return False

    # Fallback for local development or if no webhook is configured
    print(f"[SMS DEMO] To {number}: {message}")
    return False


def send_push_to_user(user_id: int, title: str, body: str, tag: str) -> None:
    if not VAPID_PRIVATE_KEY:
        print(f"[PUSH DEMO] To user {user_id}: {title} - {body}")
        return

    with db() as conn:
        subscriptions = conn.execute("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?", (user_id,)).fetchall()

    for sub in subscriptions:
        subscription_info = {"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}}
        payload = json.dumps({"title": title, "body": body, "tag": tag})
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS.copy(),
            )
        except WebPushException as exc:
            print(f"[PUSH ERROR] Could not send notification to {sub['endpoint']}: {exc}")
            if exc.response and exc.response.status_code in (404, 410):
                with db() as conn_del:
                    conn_del.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (sub["endpoint"],))


def init_db() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    conn = db()  # Use a local connection for initialization
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            employee_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
            division TEXT NOT NULL DEFAULT 'MBF 1',
            department TEXT NOT NULL,
            mobile_number TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT 'requester',
            password_salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            approval_status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            approved_at TEXT,
            approved_by INTEGER,
            FOREIGN KEY (approved_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS permits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            permit_no TEXT NOT NULL UNIQUE,
            work_description TEXT NOT NULL,
            division TEXT NOT NULL,
            department TEXT NOT NULL,
            area TEXT NOT NULL,
            equipment TEXT,
            contact_number TEXT NOT NULL DEFAULT '',
            requester_id INTEGER NOT NULL,
            requested_at TEXT NOT NULL,
            valid_from TEXT NOT NULL,
            valid_until TEXT NOT NULL,
            job_types TEXT NOT NULL,
            isolations TEXT NOT NULL,
            precautions TEXT NOT NULL,
            electrical TEXT NOT NULL,
            normalisation TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'pending_approval',
            issuer_note TEXT,
            issued_by INTEGER,
            issued_at TEXT,
            completed_by INTEGER,
            completed_at TEXT,
            closed_by INTEGER,
            closed_at TEXT,
            FOREIGN KEY (requester_id) REFERENCES users(id),
            FOREIGN KEY (issued_by) REFERENCES users(id),
            FOREIGN KEY (completed_by) REFERENCES users(id),
            FOREIGN KEY (closed_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id INTEGER,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id INTEGER,
            detail TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (actor_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """
    )
    user_columns = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "division" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN division TEXT NOT NULL DEFAULT 'MBF 1'")
    if "mobile_number" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN mobile_number TEXT NOT NULL DEFAULT ''")

    permit_columns = {row[1] for row in conn.execute("PRAGMA table_info(permits)").fetchall()}
    if "contact_number" not in permit_columns:
        conn.execute("ALTER TABLE permits ADD COLUMN contact_number TEXT NOT NULL DEFAULT ''")

    existing = conn.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    if not existing:
        initial_password = os.environ.get("INITIAL_ADMIN_PASSWORD", "ChangeMe!2026")
        salt, digest = password_hash(initial_password)
        conn.execute(
            """INSERT INTO users (full_name, employee_id, division, department, role, password_salt, password_hash,
               approval_status, created_at, approved_at) VALUES (?, ?, ?, ?, 'admin', ?, ?, 'approved', ?, ?)""",
            ("System Administrator", "ADMIN-001", "MBF 1", "Safety", salt, digest, now(), now()),
        )
        conn.execute("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)", (1, "Initial administrator created", "user", 1, '{"employee_id": "ADMIN-001"}', now()))
    conn.commit()
    conn.close()


def public_user(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "fullName": row["full_name"],
        "employeeId": row["employee_id"],
        "division": row["division"],
        "department": row["department"],
        "mobileNumber": row["mobile_number"],
        "role": row["role"],
        "approvalStatus": row["approval_status"],
        "createdAt": row["created_at"],
        "approvedAt": row["approved_at"],
    }


def permit_dict(row: sqlite3.Row, include_details: bool = False) -> dict[str, Any]:
    result = {
        "id": row["id"],
        "permitNo": row["permit_no"],
        "workDescription": row["work_description"],
        "division": row["division"],
        "department": row["department"],
        "area": row["area"],
        "equipment": row["equipment"],
        "contactNumber": row["contact_number"],
        "requesterId": row["requester_id"],
        "requesterName": row["requester_name"],
        "requestedAt": row["requested_at"],
        "validFrom": row["valid_from"],
        "validUntil": row["valid_until"],
        "status": row["status"],
        "issuerNote": row["issuer_note"],
        "issuedByName": row["issued_by_name"],
        "issuedAt": row["issued_at"],
        "completedByName": row["completed_by_name"],
        "completedAt": row["completed_at"],
        "closedByName": row["closed_by_name"],
        "closedAt": row["closed_at"],
    }
    if include_details:
        result.update({
            "jobTypes": json.loads(row["job_types"]),
            "isolations": json.loads(row["isolations"]),
            "precautions": json.loads(row["precautions"]),
            "electrical": json.loads(row["electrical"]),
            "normalisation": json.loads(row["normalisation"]),
        })
    return result


PERMIT_SELECT = """
    SELECT p.*, requester.full_name AS requester_name, issuer.full_name AS issued_by_name,
           completer.full_name AS completed_by_name, closer.full_name AS closed_by_name
    FROM permits p
    JOIN users requester ON requester.id = p.requester_id
    LEFT JOIN users issuer ON issuer.id = p.issued_by
    LEFT JOIN users completer ON completer.id = p.completed_by
    LEFT JOIN users closer ON closer.id = p.closed_by
"""


def clean_expired_sessions() -> None:
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE expires < ?", (now(),))


def get_user_from_session(token: str, required: bool, error_class: type[Exception]) -> sqlite3.Row | None:
    if not token:
        if required:
            raise error_class("Please sign in to continue.", 401)
        return None

    clean_expired_sessions()

    with db() as conn:
        session = conn.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()

    if not session or datetime.fromisoformat(session["expires"]) < datetime.now(timezone.utc):
        if session:
            with db() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        if required:
            raise error_class("Please sign in to continue.", 401)
        return None
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    if not row or row["approval_status"] != "approved":
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        raise error_class("Your account is no longer approved.", 401)
    return row


def register(data: dict[str, Any], error_class: type[Exception]) -> None:
    full_name = str(data.get("fullName", "")).strip()
    employee_id = str(data.get("employeeId", "")).strip().upper()
    division = str(data.get("division", "")).strip()
    department = str(data.get("department", "")).strip()
    mobile_number = str(data.get("mobileNumber", "")).strip()
    password = str(data.get("password", ""))
    if len(full_name) < 2 or len(full_name) > 100:
        raise error_class("Enter your full name (2–100 characters).")
    if len(employee_id) < 2 or len(employee_id) > 40:
        raise error_class("Enter a valid employee ID.")
    if division not in DIVISIONS:
        raise error_class("Choose a valid division.")
    if department not in DEPARTMENTS:
        raise error_class("Choose a valid department.")
    if not re.fullmatch(r"[+()\-\d\s]{8,20}", mobile_number):
        raise error_class("Enter a valid mobile number.")
    if len(password) < 12 or len(password) > 200:
        raise error_class("Password must be at least 12 characters.")
    salt, digest = password_hash(password)
    with db() as conn:
        try:
            cursor = conn.execute(
                """INSERT INTO users (full_name, employee_id, division, department, mobile_number, role, password_salt, password_hash, approval_status, created_at)
                   VALUES (?, ?, ?, ?, ?, 'requester', ?, ?, 'pending', ?)""",
                (full_name, employee_id, division, department, mobile_number, salt, digest, now()),
            )
            user_id = cursor.lastrowid
            details = {"division": division, "department": department, "mobile_number": mobile_number}
            conn.execute(
                "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, "Access requested", "user", user_id, json.dumps(details), now()),
            )
        except sqlite3.IntegrityError:
            raise error_class("This employee ID already has an account.", 409)


def login(data: dict[str, Any], error_class: type[Exception]) -> tuple[str, dict]:
    employee_id = str(data.get("employeeId", "")).strip().upper()
    password = str(data.get("password", ""))
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE employee_id = ?", (employee_id,)).fetchone()
    if not user:
        raise error_class("Employee ID or password is incorrect.", 401)
    _, digest = password_hash(password, user["password_salt"])
    if not secrets.compare_digest(digest, user["password_hash"]):
        raise error_class("Employee ID or password is incorrect.", 401)
    if user["approval_status"] == "pending":
        raise error_class("Your access request is awaiting administrator approval.", 403)
    if user["approval_status"] != "approved":
        raise error_class("Your account request was not approved. Contact the administrator.", 403)
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=12)
    with db() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)",
            (token, user["id"], expires.isoformat()),
        )
    return token, public_user(user)


def logout(token: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


def change_password(user: sqlite3.Row, data: dict[str, Any], error_class: type[Exception]) -> None:
    current_password = str(data.get("currentPassword", ""))
    new_password = str(data.get("newPassword", ""))
    if len(new_password) < 12 or len(new_password) > 200:
        raise error_class("New password must be 12–200 characters.")
    _, current_digest = password_hash(current_password, user["password_salt"])
    if not secrets.compare_digest(current_digest, user["password_hash"]):
        raise error_class("Current password is incorrect.", 401)
    salt, digest = password_hash(new_password)
    with db() as conn:
        conn.execute("UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?", (salt, digest, user["id"]))
        conn.execute(
            "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (user["id"], "Password changed", "user", user["id"], now()),
        )


def get_dashboard_data(user: sqlite3.Row) -> dict:
    with db() as conn:
        permit_filter = "" if user["role"] == "admin" else " WHERE requester_id = ?"
        params: tuple[Any, ...] = () if user["role"] == "admin" else (user["id"],)
        status_rows = conn.execute(f"SELECT status, COUNT(*) AS count FROM permits{permit_filter} GROUP BY status", params).fetchall()
        recent = conn.execute(PERMIT_SELECT + ("" if user["role"] == "admin" else " WHERE p.requester_id = ?") + " ORDER BY p.id DESC LIMIT 6", params).fetchall()
        pending_users = conn.execute("SELECT COUNT(*) AS count FROM users WHERE approval_status = 'pending'").fetchone()["count"] if user["role"] == "admin" else 0
    return {"counts": {r["status"]: r["count"] for r in status_rows}, "pendingUsers": pending_users, "recent": [permit_dict(r) for r in recent]}


def get_pending_users() -> list[dict]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM users WHERE approval_status = 'pending' ORDER BY created_at ASC").fetchall()
    return [public_user(r) for r in rows]


def approve_user(admin: sqlite3.Row, user_id: int, data: dict[str, Any], error_class: type[Exception]) -> str:
    role = str(data.get("role", "requester"))
    if role not in ROLES:
        raise error_class("Invalid role.")
    with db() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target or target["approval_status"] != "pending":
            raise error_class("This access request is no longer pending.", 404)
        conn.execute("UPDATE users SET approval_status = 'approved', role = ?, approved_by = ?, approved_at = ? WHERE id = ?", (role, admin["id"], now(), user_id))
        conn.execute(
            "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (admin["id"], "Access approved", "user", user_id, json.dumps({"role": role}), now()),
        )
    return target["mobile_number"]


def reject_user(admin: sqlite3.Row, user_id: int, error_class: type[Exception]) -> None:
    with db() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target or target["approval_status"] != "pending":
            raise error_class("This access request is no longer pending.", 404)
        conn.execute("UPDATE users SET approval_status = 'rejected', approved_by = ?, approved_at = ? WHERE id = ?", (admin["id"], now(), user_id))
        conn.execute(
            "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (admin["id"], "Access rejected", "user", user_id, now()),
        )


def create_permit(user: sqlite3.Row, data: dict[str, Any], error_class: type[Exception]) -> tuple[int, str]:
    description = str(data.get("workDescription", "")).strip()
    division = str(data.get("division", "")).strip()
    department = str(user.get("department") or data.get("department", "")).strip()
    area = str(data.get("area", "")).strip()
    equipment = str(data.get("equipment", "")).strip()
    contact_number = str(data.get("contactNumber", "")).strip()
    valid_from = str(data.get("validFrom", "")).strip()
    valid_until = str(data.get("validUntil", "")).strip()
    job_types = data.get("jobTypes", [])
    isolations = data.get("isolations", {})
    precautions = data.get("precautions", {})
    electrical = data.get("electrical", {})
    if len(description) < 5 or len(description) > 2000:
        raise error_class("Work description must be 5–2000 characters.")
    if division not in DIVISIONS or department not in DEPARTMENTS or not area:
        raise error_class("Complete division, department, and area/location.")
    if not re.fullmatch(r"[+()\-\d\s]{8,20}", contact_number):
        raise error_class("Enter a valid mobile number for contact.")
    if len(area) > 200 or len(equipment) > 200:
        raise error_class("Area and equipment entries are too long.")
    if not isinstance(job_types, list) or not all(isinstance(x, str) for x in job_types):
        raise error_class("Invalid job types.")
    if not all(isinstance(x, dict) for x in (isolations, precautions, electrical)):
        raise error_class("Invalid safety checklist.")
    try:
        starts = datetime.fromisoformat(valid_from.replace("Z", "+00:00"))
        ends = datetime.fromisoformat(valid_until.replace("Z", "+00:00"))
        if ends <= starts:
            raise ValueError
    except ValueError:
        raise error_class("Permit end time must be later than the start time.")

    request_time = now()
    permit_id = 0
    permit_no = ""
    admins = []

    with db() as conn:
        # Use a transaction that acquires a write lock early to prevent race conditions
        # on the daily permit sequence number generation.
        conn.execute("BEGIN IMMEDIATE")
        try:
            # This SELECT and the subsequent INSERT are now an atomic unit.
            seq_row = conn.execute("SELECT COUNT(*) AS count FROM permits WHERE date(requested_at) = date(?)", (request_time,)).fetchone()
            seq = (seq_row["count"] if seq_row else 0) + 1
            permit_no = f"SWP-{datetime.fromisoformat(request_time).strftime('%Y%m%d')}-{seq:03d}"

            cursor = conn.execute(
                """INSERT INTO permits (permit_no, work_description, division, department, area, equipment, contact_number, requester_id,
                   requested_at, valid_from, valid_until, job_types, isolations, precautions, electrical, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval')""",
                (permit_no, description, division, department, area, equipment, contact_number, user["id"], request_time, valid_from, valid_until,
                 json.dumps(job_types), json.dumps(isolations), json.dumps(precautions), json.dumps(electrical)),
            )
            permit_id = cursor.lastrowid
            conn.execute(
                "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user["id"], "Permit submitted for approval", "permit", permit_id, json.dumps({"permit_no": permit_no, "contact_number": contact_number}), request_time),
            )
            admins = conn.execute("SELECT id FROM users WHERE role = 'admin'").fetchall()
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    for admin in admins:
        send_push_to_user(admin["id"], "New Permit for Approval", f"{permit_no} was submitted by {user['full_name']}.", f"permit-{permit_id}")
    return permit_id, permit_no


def get_permits(user: sqlite3.Row) -> list[dict]:
    with db() as conn:
        if user["role"] == "admin":
            rows = conn.execute(PERMIT_SELECT + " ORDER BY p.id DESC").fetchall()
        else:
            rows = conn.execute(PERMIT_SELECT + " WHERE p.requester_id = ? ORDER BY p.id DESC", (user["id"],)).fetchall()
    return [permit_dict(r) for r in rows]


def get_permit_details(user: sqlite3.Row, permit_id: int, error_class: type[Exception]) -> tuple[dict, list[dict]]:
    with db() as conn:
        row = conn.execute(PERMIT_SELECT + " WHERE p.id = ?", (permit_id,)).fetchone()
        if not row:
            raise error_class("Permit not found.", 404)
        if user["role"] != "admin" and row["requester_id"] != user["id"]:
            raise error_class("You cannot view this permit.", 403)
        audit_rows = conn.execute(
            """SELECT a.*, u.full_name AS actor_name FROM audit_logs a
               LEFT JOIN users u ON u.id = a.actor_id
               WHERE a.entity_type = 'permit' AND a.entity_id = ? ORDER BY a.id ASC""", (permit_id,)
        ).fetchall()
    permit_data = permit_dict(row, True)
    audit_log = [{"action": a["action"], "actor": a["actor_name"] or "System", "createdAt": a["created_at"], "detail": json.loads(a["detail"])} for a in audit_rows]
    return permit_data, audit_log


def permit_for_action(permit_id: int, allowed_status: str, error_class: type[Exception]) -> sqlite3.Row:
    with db() as conn:
        row = conn.execute(PERMIT_SELECT + " WHERE p.id = ?", (permit_id,)).fetchone()
    if not row:
        raise error_class("Permit not found.", 404)
    if row["status"] != allowed_status:
        raise error_class("This permit is not in the required workflow stage.")
    return row


def issue_permit(admin: sqlite3.Row, permit_id: int, data: dict[str, Any], error_class: type[Exception]) -> str:
    decision = str(data.get("decision", "approve"))
    note = str(data.get("note", "")).strip()[:1000]
    if decision not in {"approve", "reject"}:
        raise error_class("Invalid approval decision.")
    row = permit_for_action(permit_id, "pending_approval", error_class)
    with db() as conn:
        if decision == "approve":
            conn.execute("UPDATE permits SET status = 'issued', issuer_note = ?, issued_by = ?, issued_at = ? WHERE id = ?", (note, admin["id"], now(), permit_id))
            action = "Permit issued by administrator"
            message = "Permit issued."
        else:
            conn.execute("UPDATE permits SET status = 'rejected', issuer_note = ?, issued_by = ?, issued_at = ? WHERE id = ?", (note, admin["id"], now(), permit_id))
            action = "Permit rejected by administrator"
            message = "Permit rejected."
        conn.execute(
            "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (admin["id"], action, "permit", permit_id, json.dumps({"note": note, "permit_no": row["permit_no"]}), now()),
        )
    send_push_to_user(row["requester_id"], f"Permit {decision.capitalize()}d", f"Your permit {row['permit_no']} was {decision}d by an administrator.", f"permit-{permit_id}")
    return message


def complete_permit(user: sqlite3.Row, permit_id: int, data: dict[str, Any], error_class: type[Exception]) -> None:
    row = permit_for_action(permit_id, "issued", error_class)
    if user["role"] != "admin" and row["requester_id"] != user["id"]:
        raise error_class("Only the requesting person can mark this job complete.", 403)
    normalisation = data.get("normalisation", {})
    if not isinstance(normalisation, dict):
        raise error_class("Invalid normalisation checklist.")
    with db() as conn:
        conn.execute("UPDATE permits SET status = 'job_completed', normalisation = ?, completed_by = ?, completed_at = ? WHERE id = ?", (json.dumps(normalisation), user["id"], now(), permit_id))
        conn.execute(
            "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (user["id"], "Job completion submitted", "permit", permit_id, now()),
        )


def close_permit(admin: sqlite3.Row, permit_id: int, error_class: type[Exception]) -> str:
    row = permit_for_action(permit_id, "job_completed", error_class)
    with db() as conn:
        conn.execute("UPDATE permits SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ?", (admin["id"], now(), permit_id))
        conn.execute(
            "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (admin["id"], "Permit closed after normalisation review", "permit", permit_id, json.dumps({"permit_no": row["permit_no"]}), now()),
        )
    return row["permit_no"]


def save_push_subscription(user_id: int, sub_data: dict, error_class: type[Exception]):
    endpoint = sub_data.get("endpoint")
    p256dh = sub_data.get("keys", {}).get("p256dh")
    auth = sub_data.get("keys", {}).get("auth")
    if not all([endpoint, p256dh, auth]):
        raise error_class("Incomplete push subscription object.")
    with db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, endpoint, p256dh, auth, now())
        )

def delete_push_subscription(user_id: int, endpoint: str):
    with db() as conn:
        conn.execute("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", (user_id, endpoint))
