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

DEPARTMENTS = ["Mechanical", "Operation", "Electrical/Instrumentation", "Utility", "Safety & Fire", "Civil"]
DIVISIONS = ["MBF 1", "MBF 2", "Sinter 1", "Sinter 2", "SMS", "CCM", "Rolling Mill", "CMD"]
DESIGNATIONS = [
    "Junior Engineer (JE)", "Engineer", "Senior Engineer (SE)", "Assistant Manager (AM)",
    "Deputy Manager (DM)", "Manager", "Senior Manager", "Assistant General Manager (AGM)",
    "Senior Assistant General Manager (Sr.AGM)", "Deputy General Manager (DGM)",
    "Senior Deputy General Manager (Sr.DGM)", "General Manager (GM)"
]
ROLES = ["requester", "issuer", "safety", "admin"]
PERMIT_STATUSES = ["pending_department_approval", "pending_approval", "issued", "job_completed", "closed", "rejected"]
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
            designation TEXT NOT NULL DEFAULT 'Engineer',
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

        CREATE TABLE IF NOT EXISTS permit_approvals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            permit_id INTEGER NOT NULL,
            department TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            approver_id INTEGER,
            approver_name TEXT,
            approver_mobile TEXT,
            approved_at TEXT,
            detail TEXT NOT NULL DEFAULT '{}',
            stage INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (permit_id) REFERENCES permits(id) ON DELETE CASCADE,
            FOREIGN KEY (approver_id) REFERENCES users(id),
            UNIQUE (permit_id, department, stage)
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
        # NOTE: For a production environment, use a dedicated migration tool like
        # Alembic or sqlite-migrate instead of ad-hoc ALTER TABLE statements.
        conn.execute("ALTER TABLE users ADD COLUMN division TEXT NOT NULL DEFAULT 'MBF 1'")
    if "designation" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN designation TEXT NOT NULL DEFAULT 'Engineer'")
    if "mobile_number" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN mobile_number TEXT NOT NULL DEFAULT ''")

    permit_columns = {row[1] for row in conn.execute("PRAGMA table_info(permits)").fetchall()}
    if "contact_number" not in permit_columns:
        # NOTE: For a production environment, use a dedicated migration tool like
        # Alembic or sqlite-migrate instead of ad-hoc ALTER TABLE statements.
        conn.execute("ALTER TABLE permits ADD COLUMN contact_number TEXT NOT NULL DEFAULT ''")

    permit_approvals_columns = {row[1] for row in conn.execute("PRAGMA table_info(permit_approvals)").fetchall()}
    if "stage" not in permit_approvals_columns:
        conn.execute("ALTER TABLE permit_approvals ADD COLUMN stage INTEGER NOT NULL DEFAULT 1")
    if "detail" not in permit_approvals_columns:
        conn.execute("ALTER TABLE permit_approvals ADD COLUMN detail TEXT NOT NULL DEFAULT '{}'")


    existing = conn.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    if not existing:
        initial_password = os.environ.get("INITIAL_ADMIN_PASSWORD", "ChangeMe!2026")
        salt, digest = password_hash(initial_password)
        conn.execute(
            """INSERT INTO users (full_name, employee_id, division, department, role, password_salt, password_hash,
               approval_status, created_at, approved_at) VALUES (?, ?, ?, ?, 'admin', ?, ?, 'approved', ?, ?)""",
            ("System Administrator", "ADMIN-001", "MBF 1", "Mechanical", salt, digest, now(), now()),
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
        "designation": row["designation"],
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
    designation = str(data.get("designation", "")).strip()
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
    if designation not in DESIGNATIONS:
        raise error_class("Choose a valid designation.")
    if not re.fullmatch(r"\d{10}", mobile_number):
        raise error_class("Enter a valid 10-digit mobile number.")
    if len(password) < 12 or len(password) > 200:
        raise error_class("Password must be at least 12 characters.")
    salt, digest = password_hash(password)
    with db() as conn:
        try:
            cursor = conn.execute(
                """INSERT INTO users (full_name, employee_id, division, department, designation, mobile_number, role, password_salt, password_hash, approval_status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'requester', ?, ?, 'pending', ?)""",
                (full_name, employee_id, division, department, designation, mobile_number, salt, digest, now()),
            )
            user_id = cursor.lastrowid
            details = {"division": division, "department": department, "designation": designation, "mobile_number": mobile_number}
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
    if user["approval_status"] == "deactivated":
        raise error_class("This account has been deactivated. Contact an administrator.", 403)
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
        if user["role"] == "admin":
            status_rows = conn.execute("SELECT status, COUNT(*) AS count FROM permits GROUP BY status").fetchall()
            recent = conn.execute(PERMIT_SELECT + " ORDER BY p.id DESC LIMIT 6").fetchall()
            pending_users = conn.execute("SELECT COUNT(*) AS count FROM users WHERE approval_status = 'pending'").fetchone()["count"]
        else:
            # Non-admins see stats and recent permits for their division only.
            params = (user["division"],)
            status_rows = conn.execute(
                "SELECT status, COUNT(*) AS count FROM permits WHERE division = ? GROUP BY status", params
            ).fetchall()
            recent = conn.execute(
                PERMIT_SELECT + " WHERE p.division = ? ORDER BY p.id DESC LIMIT 6", params
            ).fetchall()
            pending_users = 0
    return {"counts": {r["status"]: r["count"] for r in status_rows}, "pendingUsers": pending_users, "recent": [permit_dict(r) for r in recent]}


def get_users_for_admin() -> list[dict]:
    """Gets all users, sorted to show pending requests first."""
    with db() as conn:
        rows = conn.execute("""
            SELECT * FROM users
            ORDER BY
                CASE approval_status
                    WHEN 'pending' THEN 1
                    WHEN 'approved' THEN 2
                    WHEN 'rejected' THEN 3
                    WHEN 'deactivated' THEN 4
                    ELSE 5
                END,
                created_at DESC
        """).fetchall()
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


def deactivate_user(admin: sqlite3.Row, user_id: int, error_class: type[Exception]) -> None:
    with db() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            raise error_class("User not found.", 404)
        if target["id"] == admin["id"]:
            raise error_class("You cannot deactivate your own account.", 400)
        if target["employee_id"] == "ADMIN-001":
            raise error_class("The primary administrator account cannot be deactivated.", 400)
        if target["approval_status"] != 'approved':
            raise error_class("Only approved users can be deactivated.", 400)

        # Use a transaction to ensure atomicity
        conn.execute("BEGIN")
        try:
            conn.execute("UPDATE users SET approval_status = 'deactivated' WHERE id = ?", (user_id,))
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            conn.execute(
                "INSERT INTO audit_logs (actor_id, action, entity_type, detail, created_at) VALUES (?, ?, ?, ?, ?)",
                (admin["id"], "User account deactivated", "system", json.dumps({"deactivated_user_id": user_id, "employee_id": target["employee_id"]}), now()),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def create_permit(user: sqlite3.Row, data: dict[str, Any], error_class: type[Exception]) -> tuple[int, str]:
    description = str(data.get("workDescription", "")).strip()
    department = str(data.get("department", "")).strip()
    area = str(data.get("area", "")).strip()
    equipment = str(data.get("equipment", "")).strip()
    contact_number = str(data.get("contactNumber", "")).strip()
    valid_from = str(data.get("validFrom", "")).strip()
    valid_until = str(data.get("validUntil", "")).strip()

    is_cmd_user = user['division'] == 'CMD'
    if is_cmd_user:
        permit_division = str(data.get("targetDivision", "")).strip()
        if permit_division not in DIVISIONS or permit_division == 'CMD':
            raise error_class("A valid target work division must be selected for CMD permits.")
    else:
        permit_division = str(user["division"]).strip()

    required_isolations = data.get("requiredIsolations", [])
    precautions = data.get("precautions", {})

    if len(description) < 5 or len(description) > 2000:
        raise error_class("Work description must be 5–2000 characters.")
    if permit_division not in DIVISIONS or department not in DEPARTMENTS or not area:
        raise error_class("Complete division, department, and area/location.")
    if not re.fullmatch(r"\d{10}", contact_number):
        raise error_class("Enter a valid 10-digit mobile number for contact.")
    if len(area) > 200 or len(equipment) > 200:
        raise error_class("Area and equipment entries are too long.")
    if not isinstance(required_isolations, list) or not all(isinstance(x, str) for x in required_isolations):
        raise error_class("Invalid required isolations.")
    if not isinstance(precautions, dict):
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
    approver_users = []

    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            today_str = datetime.fromisoformat(request_time).strftime('%Y%m%d')
            permit_no_prefix = f"SWP-{today_str}-"

            last_permit_for_day = conn.execute(
                "SELECT permit_no FROM permits WHERE permit_no LIKE ? ORDER BY permit_no DESC LIMIT 1",
                (permit_no_prefix + '%',)
            ).fetchone()

            seq = 1
            if last_permit_for_day:
                try:
                    last_seq_str = last_permit_for_day["permit_no"].split('-')[-1]
                    seq = int(last_seq_str) + 1
                except (ValueError, IndexError):
                    seq = 1

            permit_no = f"{permit_no_prefix}{seq:03d}"

            # --- Approval Workflow Calculation ---
            # This list will hold tuples of (department, approver_division)
            approval_flow = []
            high_risk_keys = {"hotEquipment", "hotAreaClear", "hotMasking", "hotOpenings", "hotExtinguisher", "hotPurging", "confinedAirTest", "oxygen", "openings", "entryPermit", "standby", "trained", "scaffolding", "safetyBelt", "ladders", "accessToolhold", "excavationManual", "cables", "pipes"}
            is_high_risk = any(precautions.get(key) for key in high_risk_keys)

            if is_cmd_user:
                # Specialized workflow for CMD division
                # Stage 1: Target Division Operation
                if "Operation" in required_isolations:
                    approval_flow.append(("Operation", permit_division))
                
                # Intermediate Stages: CMD Mechanical and/or Electrical
                cmd_stages = []
                if "Mechanical" in required_isolations:
                    cmd_stages.append(("Mechanical", "CMD"))
                if "Electrical" in required_isolations:
                    cmd_stages.append(("Electrical/Instrumentation", "CMD"))
                approval_flow.extend(sorted(cmd_stages)) # Sort to keep order consistent

                # Final Stage: Safety & Fire in Target Division (if high-risk)
                if is_high_risk:
                    approval_flow.append(("Safety & Fire", permit_division))
            else:
                # Standard workflow for all other divisions
                standard_flow = []
                if "Operation" in required_isolations:
                    standard_flow.append("Operation")
                
                intermediate_isolations = ["Mechanical", "Utility", "Electrical/Instrumentation"]
                for dept in intermediate_isolations:
                    if dept in required_isolations:
                        standard_flow.append(dept)
                
                if is_high_risk:
                    standard_flow.append("Safety & Fire")
                
                # Convert to new format, filtering out requester's own dept
                ordered_approvers = list(dict.fromkeys(standard_flow))
                final_approvers = [dep for dep in ordered_approvers if dep != department]
                for dep in final_approvers:
                    approval_flow.append((dep, permit_division))

            approving_departments_with_stages = []
            if approval_flow:
                for i, (dep, approver_div) in enumerate(approval_flow):
                    approving_departments_with_stages.append((dep, i + 1, approver_div))

            status = 'pending_approval'
            if approving_departments_with_stages:
                status = 'pending_department_approval'

            cursor = conn.execute(
                """INSERT INTO permits (permit_no, work_description, division, department, area, equipment, contact_number, requester_id, 
                   requested_at, valid_from, valid_until, job_types, isolations, precautions, electrical, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (permit_no, description, permit_division, department, area, equipment, contact_number, user["id"], request_time, valid_from, valid_until,
                 json.dumps([]), json.dumps({}), json.dumps(precautions), json.dumps({}), status),
            )
            permit_id = cursor.lastrowid

            if approving_departments_with_stages:
                for dep, stage, approver_div in approving_departments_with_stages:
                    detail_json = json.dumps({'approver_division': approver_div})
                    conn.execute(
                        "INSERT INTO permit_approvals (permit_id, department, stage, detail) VALUES (?, ?, ?, ?)",
                        (permit_id, dep, stage, detail_json)
                    )
                
                stage1_approvals = [(dep, approver_div) for dep, stage, approver_div in approving_departments_with_stages if stage == 1]
                for dep, approver_div in stage1_approvals:
                    approver_users = conn.execute(
                        "SELECT id FROM users WHERE department = ? AND division = ? AND approval_status = 'approved'",
                        (dep, approver_div)
                    ).fetchall()

            conn.execute(
                "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user["id"], "Permit submitted for approval", "permit", permit_id, json.dumps({"permit_no": permit_no, "contact_number": contact_number}), request_time),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    for approver in approver_users:
        send_push_to_user(approver["id"], "Permit Requires Your Approval", f"Permit {permit_no} for division {permit_division} needs approval from your department.", f"permit-{permit_id}")

    return permit_id, permit_no


def get_permits(user: sqlite3.Row) -> list[dict]:
    with db() as conn:
        if user["role"] == "admin":
            rows = conn.execute(PERMIT_SELECT + " ORDER BY p.id DESC").fetchall()
        else:
            # Non-admins see all permits in their own division.
            rows = conn.execute(
                PERMIT_SELECT + " WHERE p.division = ? ORDER BY p.id DESC", (user["division"],)
            ).fetchall()
    return [permit_dict(r) for r in rows]


def get_permit_details(user: sqlite3.Row, permit_id: int, error_class: type[Exception]) -> tuple[dict, list[dict], list[dict]]:
    with db() as conn:
        row = conn.execute(PERMIT_SELECT + " WHERE p.id = ?", (permit_id,)).fetchone()
        if not row:
            raise error_class("Permit not found.", 404)

        # Authorization check: Any user can see any permit within their own division.
        # Or if they requested it. Or if they are a pending approver.
        is_admin = user["role"] == "admin"
        is_in_division_or_requester = (row["division"] == user["division"] or row['requester_id'] == user['id'])

        is_pending_approver = False
        pending_approvals = conn.execute("""
            SELECT department, detail FROM permit_approvals
            WHERE permit_id = ? AND status = 'pending'
            AND stage = (SELECT MIN(stage) FROM permit_approvals WHERE permit_id = ? AND status = 'pending')
        """, (permit_id, permit_id)).fetchall()

        for pa in pending_approvals:
            pa_detail = json.loads(pa['detail'] or '{}')
            # Default to permit's division if approver_division not specified (for backward compatibility)
            approver_division = pa_detail.get('approver_division', row['division'])
            if pa['department'] == user['department'] and approver_division == user['division']:
                is_pending_approver = True
                break

        if not (is_admin or is_in_division_or_requester or is_pending_approver):
            raise error_class("You do not have permission to view this permit.", 403)

        audit_rows = conn.execute(
            """SELECT a.*, u.full_name AS actor_name FROM audit_logs a
               LEFT JOIN users u ON u.id = a.actor_id
               WHERE a.entity_type = 'permit' AND a.entity_id = ? ORDER BY a.id ASC""", (permit_id,)
        ).fetchall()
        approvals_rows = conn.execute(
            "SELECT * FROM permit_approvals WHERE permit_id = ? ORDER BY stage ASC, department ASC", (permit_id,)
        ).fetchall()
    permit_data = permit_dict(row, True)

    max_stage = 0
    if approvals_rows:
        max_stage = max(r['stage'] for r in approvals_rows)

    audit_log = [{"action": a["action"], "actor": a["actor_name"] or "System", "createdAt": a["created_at"], "detail": json.loads(a["detail"])} for a in audit_rows]
    approvals = [
        {
            "id": r["id"],
            "permitId": r["permit_id"],
            "department": r["department"],
            "status": r["status"],
            "approverId": r["approver_id"],
            "stage": r["stage"],
            "isFinal": r["stage"] == max_stage if max_stage > 0 else False,
            "approverName": r["approver_name"],
            "approverMobile": r["approver_mobile"],
            "approvedAt": r["approved_at"],
            "detail": json.loads(r["detail"] or '{}'),
        } for r in approvals_rows
    ]
    return permit_data, audit_log, approvals


def get_actionable_permits() -> list[dict]:
    """Gets permits that are awaiting an administrator action (issue or close)."""
    with db() as conn:
        rows = conn.execute(
            PERMIT_SELECT + " WHERE p.status IN ('pending_approval', 'job_completed') ORDER BY p.id DESC"
        ).fetchall()
    return [permit_dict(r) for r in rows]


def department_approve_permit(user: sqlite3.Row, permit_id: int, data: dict[str, Any], error_class: type[Exception]) -> None:
    if user["role"] == "admin":
        raise error_class("Administrators have read-only access and cannot approve or reject permits.", 403)
    decision = str(data.get("decision", "approved")).strip()
    if decision not in ['approved', 'rejected']:
        raise error_class("Invalid decision.")
    precautions_data = data.get("precautions", {})
    if not isinstance(precautions_data, dict):
        raise error_class("Invalid precautions data.")

    with db() as conn:
        conn.execute("BEGIN")
        try:
            permit = conn.execute(PERMIT_SELECT + " WHERE p.id = ?", (permit_id,)).fetchone()
            if not permit:
                raise error_class("Permit not found.", 404)
            if permit["status"] != "pending_department_approval":
                raise error_class("This permit is not in the required workflow stage.")

            user_department = user["department"]
            
            approval_slot = conn.execute(
                """SELECT * FROM permit_approvals
                   WHERE permit_id = ? AND department = ? AND status = 'pending'
                   AND stage = (
                       SELECT MIN(stage) FROM permit_approvals
                       WHERE permit_id = ? AND status = 'pending'
                   )""",
                (permit_id, user_department, permit_id)
            ).fetchone()
            if not approval_slot:
                raise error_class("Your department is not required to approve this permit at this stage, or it has already been actioned.", 403)

            # Security check: Verify user's division matches the required approver division for this step.
            slot_detail = json.loads(approval_slot['detail'] or '{}')
            required_division = slot_detail.get('approver_division')
            # Fallback for older permits or non-CMD workflows: approver must be in the permit's division.
            if not required_division:
                required_division = permit['division']

            if user['division'] != required_division:
                raise error_class(f"This approval is designated for the {required_division} division, but you are in the {user['division']} division.", 403)

            approver_name = str(data.get("approverName", user["full_name"])).strip()
            approver_mobile = str(data.get("approverMobile", user["mobile_number"])).strip()
            conn.execute(
                """UPDATE permit_approvals SET status = ?, approver_id = ?, approver_name = ?,
                   approver_mobile = ?, approved_at = ?, detail = ? WHERE id = ?""",
                (decision, user["id"], approver_name, approver_mobile, now(), json.dumps(precautions_data), approval_slot["id"])
            )
            conn.execute(
                "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user["id"], f"Department ({user_department}) {decision} permit", "permit", permit_id, json.dumps({"permit_no": permit["permit_no"]}), now()),
            )

            if decision == 'rejected':
                conn.execute("UPDATE permits SET status = 'rejected' WHERE id = ?", (permit_id,))
                send_push_to_user(permit["requester_id"], "Permit Rejected", f"Permit {permit['permit_no']} was rejected by the {user_department} department.", f"permit-{permit_id}")
                conn.commit()
                return

            remaining_approvals = conn.execute(
                "SELECT COUNT(*) as count FROM permit_approvals WHERE permit_id = ? AND status = 'pending'",
                (permit_id,)
            ).fetchone()["count"]

            if remaining_approvals == 0:
                # All departmental approvals are done. The permit is now issued.
                current_time = now()
                conn.execute(
                    "UPDATE permits SET status = 'issued', issued_at = ?, issued_by = ? WHERE id = ?",
                    (current_time, user["id"], permit_id)
                )
                conn.execute(
                    "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (user["id"], "Final departmental approval received, permit issued", "permit", permit_id, json.dumps({"permit_no": permit["permit_no"]}), current_time),
                )
                # Notify the requester that the permit is issued.
                send_push_to_user(permit["requester_id"], "Permit Issued", f"Your permit {permit['permit_no']} has been fully approved and is now active.", f"permit-{permit_id}")
            else:
                # There are still pending approvals, notify the next stage
                next_stage_info = conn.execute(
                    """SELECT department, detail FROM permit_approvals
                       WHERE permit_id = ? AND status = 'pending'
                       ORDER BY stage ASC LIMIT 1""",
                    (permit_id,)
                ).fetchone()
                if next_stage_info:
                    next_dept = next_stage_info['department']
                    next_detail = json.loads(next_stage_info['detail'] or '{}')
                    next_approver_div = next_detail.get('approver_division', permit['division'])
                    approver_users = conn.execute(
                        "SELECT id FROM users WHERE department = ? AND division = ? AND approval_status = 'approved'",
                        (next_dept, next_approver_div)
                    ).fetchall()
                    for approver in approver_users:
                        send_push_to_user(approver["id"], "Permit Requires Your Approval", f"Permit {permit['permit_no']} for division {permit['division']} is now awaiting approval from your department.", f"permit-{permit_id}")

            conn.commit()

        except Exception:
            conn.rollback()
            raise


def issue_permit(user: sqlite3.Row, permit_id: int, data: dict[str, Any], error_class: type[Exception]) -> str:
    decision = str(data.get("decision", "approve"))
    note = str(data.get("note", "")).strip()[:1000]
    if decision not in {"approve", "reject"}:
        raise error_class("Invalid approval decision.")

    with db() as conn:
        row = conn.execute(PERMIT_SELECT + " WHERE p.id = ?", (permit_id,)).fetchone()
    if not row:
        raise error_class("Permit not found.", 404)
    if row["status"] != "pending_approval":
        raise error_class("This permit is not in the required workflow stage.")
    with db() as conn:
        if decision == "approve":
            conn.execute("UPDATE permits SET status = 'issued', issuer_note = ?, issued_by = ?, issued_at = ? WHERE id = ?", (note, user["id"], now(), permit_id))
            action = f"Permit issued by {user['role'].capitalize()}"
            message = "Permit issued."
        else:
            conn.execute("UPDATE permits SET status = 'rejected', issuer_note = ?, issued_by = ?, issued_at = ? WHERE id = ?", (note, user["id"], now(), permit_id))
            action = f"Permit rejected by {user['role'].capitalize()}"
            message = "Permit rejected."
        conn.execute(
            "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user["id"], action, "permit", permit_id, json.dumps({"note": note, "permit_no": row["permit_no"]}), now()),
        )
    send_push_to_user(row["requester_id"], f"Permit {decision.capitalize()}d", f"Your permit {row['permit_no']} was {decision}d by the issuing authority.", f"permit-{permit_id}")
    return message


def complete_permit(user: sqlite3.Row, permit_id: int, data: dict[str, Any], error_class: type[Exception]) -> None:
    with db() as conn:
        row = conn.execute(PERMIT_SELECT + " WHERE p.id = ?", (permit_id,)).fetchone()
    if not row:
        raise error_class("Permit not found.", 404)
    if row["status"] != "issued":
        raise error_class("This permit is not in the required workflow stage.")
    if user["role"] != "admin" and row["requester_id"] != user["id"]:
        raise error_class("Only the requesting person can mark this job complete.", 403)
    normalisation = data.get("normalisation", {})
    if not isinstance(normalisation, dict):
        raise error_class("Invalid normalisation checklist.")

    admins = []
    with db() as conn:
        conn.execute("UPDATE permits SET status = 'job_completed', normalisation = ?, completed_by = ?, completed_at = ? WHERE id = ?", (json.dumps(normalisation), user["id"], now(), permit_id))
        conn.execute(
            "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (user["id"], "Job completion submitted", "permit", permit_id, now()),
        )
        admins = conn.execute("SELECT id FROM users WHERE role = 'admin'").fetchall()

    for admin in admins:
        send_push_to_user(
            admin["id"], "Permit Ready for Closure",
            f"Job for {row['permit_no']} was completed by {user['full_name']}. Please review and close.", f"permit-{permit_id}"
        )


def close_permit(admin: sqlite3.Row, permit_id: int, error_class: type[Exception]) -> str:
    with db() as conn:
        row = conn.execute(PERMIT_SELECT + " WHERE p.id = ?", (permit_id,)).fetchone()
    if not row:
        raise error_class("Permit not found.", 404)
    if row["status"] != "job_completed":
        raise error_class("This permit is not in the required workflow stage.")
    with db() as conn:
        conn.execute("UPDATE permits SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ?", (admin["id"], now(), permit_id))
        conn.execute(
            "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (admin["id"], "Permit closed after normalisation review", "permit", permit_id, json.dumps({"permit_no": row["permit_no"]}), now()),
        )
    return row["permit_no"]


def delete_permit(admin: sqlite3.Row, permit_id: int, error_class: type[Exception]) -> None:
    with db() as conn:
        row = conn.execute("SELECT permit_no FROM permits WHERE id = ?", (permit_id,)).fetchone()
        if not row:
            raise error_class("Permit not found.", 404)

        # Use a transaction to ensure atomicity
        conn.execute("BEGIN")
        try:
            # Delete the permit itself. This will cascade to permit_approvals.
            # We preserve the audit logs for historical integrity. They will refer
            # to a deleted permit ID, but the log detail contains the permit number.
            conn.execute("DELETE FROM permits WHERE id = ?", (permit_id,))
            # Finally, log the deletion action as a system event
            conn.execute(
                "INSERT INTO audit_logs (actor_id, action, entity_type, detail, created_at) VALUES (?, ?, ?, ?, ?)",
                (admin["id"], "Permit deleted", "system", json.dumps({"permit_no": row["permit_no"], "deleted_permit_id": permit_id}), now()),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

def auto_close_expired_permits() -> None:
    """Finds all 'issued' permits where valid_until has passed and closes them."""
    current_time = now()
    with db() as conn:
        # Find expired permits that are still marked as 'issued'
        expired_permits = conn.execute(
            "SELECT id, permit_no FROM permits WHERE status = 'issued' AND valid_until < ?",
            (current_time,)
        ).fetchall()

        if not expired_permits:
            return

        expired_ids = [p["id"] for p in expired_permits]
        placeholder = ",".join("?" for _ in expired_ids)

        # Use a transaction to update all expired permits and their audit logs atomically
        conn.execute("BEGIN")
        try:
            # Update status to 'closed' and set closed_at time. closed_by remains NULL for system actions.
            conn.execute(
                f"UPDATE permits SET status = 'closed', closed_at = ? WHERE id IN ({placeholder})",
                (current_time, *expired_ids)
            )

            # Add audit log entries for each closed permit
            audit_entries = []
            for permit in expired_permits:
                audit_entries.append(
                    (None, "Permit automatically closed after 8-hour expiry period.", "permit", permit["id"], json.dumps({"permit_no": permit["permit_no"]}), current_time)
                )
            conn.executemany(
                "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                audit_entries
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

def reset_database(error_class: type[Exception]) -> None:
    """Wipes all transactional data and non-admin users, resetting the DB to a clean state."""
    with db() as conn:
        # Check if the admin user exists to get its ID.
        admin_user = conn.execute("SELECT id FROM users WHERE employee_id = 'ADMIN-001'").fetchone()

        # If admin doesn't exist, re-initialize from scratch.
        if not admin_user:
            print("Admin user not found. Re-initializing the entire database from scratch.")
            conn.close()
            if DB_PATH.exists():
                DB_PATH.unlink()
            init_db()
            print("Database has been completely re-initialized.")
            return

        admin_id = admin_user["id"]
        print(f"Preserving admin user (ID: {admin_id}, Employee ID: ADMIN-001)...")

        # Use a transaction for atomicity
        conn.execute("BEGIN")
        try:
            # 1. Clear all transactional tables.
            # Deleting from permits will cascade to permit_approvals.
            print("Deleting all permits and departmental approvals...")
            conn.execute("DELETE FROM permits")

            print("Deleting all audit logs...")
            conn.execute("DELETE FROM audit_logs")

            # 2. Clear sessions and push subscriptions for all users (admin will re-login).
            print("Deleting all user sessions and push subscriptions...")
            conn.execute("DELETE FROM sessions")
            conn.execute("DELETE FROM push_subscriptions")

            # 3. Delete all non-admin users.
            print("Deleting all non-admin user accounts...")
            conn.execute("DELETE FROM users WHERE id != ?", (admin_id,))

            # 4. Reset admin password to the initial default.
            initial_password = os.environ.get("INITIAL_ADMIN_PASSWORD", "ChangeMe!2026")
            print(f"Resetting admin password to default ('{initial_password}' if INITIAL_ADMIN_PASSWORD env var is not set)...")
            salt, digest = password_hash(initial_password)
            conn.execute("UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?", (salt, digest, admin_id))

            # 5. Log this reset action as the only remaining audit log.
            conn.execute("INSERT INTO audit_logs (actor_id, action, entity_type, detail, created_at) VALUES (?, ?, ?, ?, ?)", (admin_id, "Database reset to clean state", "system", '{}', now()))
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise error_class(f"Failed to reset database. Changes were rolled back. Error: {e}", 500) from e

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
