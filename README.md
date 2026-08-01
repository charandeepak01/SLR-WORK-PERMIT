# SLR Digital Safe Work Permit

A local, responsive web app that turns the SLR Safe Work Permit paper form into an approval-controlled digital workflow.

## What it does

- A person must request access with their employee ID, department, and password.
- Only the administrator can approve or reject access requests.
- Approved users can submit safe work permits for MBF 1, MBF 2, Sinter 1, Sinter 2, SMS, CCM, and Rolling Mill.
- Each permit captures the key isolation, electrical, and general safety precautions from the paper form.
- Only the administrator can issue/reject permits and close them after job completion.
- Every key action is kept in the permit's audit trail.

## Run it on a Windows computer

1. Install [Python 3.11 or later](https://www.python.org/downloads/) and select **Add Python to PATH** during installation.
2. Open PowerShell in this folder.
3. Optional but recommended: set your own first administrator password for this run:

   ```powershell
   $env:INITIAL_ADMIN_PASSWORD = "Choose-a-strong-password"
   ```

4. Configure push notifications (optional):

   To enable real-time browser push notifications, you need to generate VAPID keys.

   ```powershell
   # First, install the pywebpush helper if you haven't already
   pip install pywebpush
   # Then, generate the keys
   vapid --gen
   ```

   This will print a private and public key. Set them as environment variables before starting the app:

   ```powershell
   $env:VAPID_PRIVATE_KEY = "paste-your-private-key-here"
   $env:VAPID_PUBLIC_KEY = "paste-your-public-key-here"
   ```

5. Configure an SMS provider (optional) if you want user approval notifications to be sent via text message:

   ```powershell
   $env:SMS_WEBHOOK_URL = "https://your-generic-sms-webhook.example/send"
   ```

6. Start the app by double-clicking `start_app.bat`. This will install the required packages and start a production-ready server.

   The script will print the URLs where the app is running.

7. Open `http://127.0.0.1:8081` in a browser.

The first account is:

- Employee ID: `ADMIN-001`
- Password: `ChangeMe!2026` (unless you set `INITIAL_ADMIN_PASSWORD` before the first run)

Use that account only to approve employee access and permits. Immediately select **Change password** after signing in and replace the supplied default; for a real company rollout, use company authentication, HTTPS, secure backups, and a reviewed e-signature policy.

## Running the server continuously on Windows

To ensure the server runs continuously, even after a reboot, you should run it as a Windows Service. The `start_app.bat` script is for manual execution. For a production setup, a service manager like `nssm` is recommended.

1.  **Download nssm:** Go to the nssm website and download the latest release. Extract the `nssm.exe` file (from the `win64` folder) into a folder that is in your system's PATH, or just place it in this project directory for ease of use.

2.  **Create a wrapper script:** Create a new file named `run_service.bat` in the same directory as `start_app.bat` with the following content. This script will set the working directory and call the Python server directly, which is more reliable for a service.

    ```batch
    @echo off
    cd /d "%~dp0"
    echo Starting SLR Permit Server...
    py -m waitress --host=0.0.0.0 --port=8081 app:app
    ```
    *Note: Ensure `py` is the correct command for your Python installation. If not, replace it with `python`.*

3.  **Install the service:** Open a Command Prompt or PowerShell **as an Administrator**. Navigate to the project directory and run the following command:

    ```powershell
    .\nssm.exe install "SLRPermitApp" "C:\path\to\your\project\run_service.bat"
    ```
    *Replace `C:\path\to\your\project\` with the full, absolute path to where you saved `run_service.bat`.*

4.  **Configure the service (optional but recommended):**
    NSSM's GUI will open.
    - On the **Application** tab, the paths should be correct.
    - Go to the **Details** tab and set a "Display name" like `SLR Digital Safe Work Permit`.
    - Go to the **I/O** tab and redirect stdout and stderr to log files (e.g., `C:\path\to\your\project\logs\service.log`). This is crucial for debugging. Make sure the `logs` directory exists.
    - Click **Install service**.

5.  **Start the service:**

    ```powershell
    .\nssm.exe start SLRPermitApp
    ```

    You can now manage the service from the Windows Services app (`services.msc`) or using nssm commands (`stop`, `restart`, `status`). The server will now start automatically when the computer boots.

## Deploying to Vercel

This application can be deployed to Vercel for demonstration purposes. However, due to Vercel's ephemeral filesystem, the SQLite database will be temporary and all data (users, permits, etc.) will be lost when the serverless function goes to sleep or is redeployed.

1.  **Push your code** to a GitHub repository and connect it to a new Vercel project.
2.  **Add Environment Variables:** In your Vercel project settings, go to **Settings > Environment Variables** and add the following:
    - `INITIAL_ADMIN_PASSWORD`: Set this to the secure password you want for the `ADMIN-001` account. **This is required for you to be able to log in.**
    - `VAPID_PRIVATE_KEY` (optional): Your VAPID private key for push notifications.
    - `VAPID_PUBLIC_KEY` (optional): Your VAPID public key for push notifications.
3.  **Deploy:** Trigger a new deployment from the Vercel dashboard.

After deployment, you can log in with:

- Employee ID: `ADMIN-001`
- Password: The value you set for `INITIAL_ADMIN_PASSWORD`.

For a production deployment on Vercel, you must migrate from SQLite to a managed database service like Vercel Postgres.

## Database Management

All application data is stored in the `data/work_permit.db` SQLite file.

### Resetting the Database

If you need to reset the application to a clean state for testing or to start fresh, a command-line script is provided. This action is **irreversible** and will:

-   Delete all work permits and their approval history.
-   Delete all audit logs.
-   Delete all user accounts **except for the primary administrator (`ADMIN-001`)**.
-   Reset the password for the `ADMIN-001` account to its initial default (`ChangeMe!2026` or the value of `INITIAL_ADMIN_PASSWORD`).

To run the reset script:

1.  Stop the server if it is running.
2.  Open PowerShell or Command Prompt in the project directory.
3.  Run the following command:

    ```powershell
    py -m flask --app app reset-db
    ```

4.  You will be prompted to confirm the action. Type `y` and press Enter to proceed.

## Data location and backup

All app data is stored in `data/work_permit.db`. Back up this file while the server is stopped. Do not put it in public cloud sharing folders or send it through unencrypted email.

## Workflow

`Access request → Administrator approval → Permit submitted → Administrator issues → Job completed → Administrator closes`

This initial version is ideal as a pilot in MBF 1. Before live safety use, have your Safety, Operations, Mechanical, and Electrical authorities validate every checklist and approval requirement against your company procedure.

## Troubleshooting

### "Refused to connect" or "Server not reachable" from another device

If you cannot access the app from another device on the same Wi-Fi network (like your phone), the cause is almost always the Windows Firewall.

1.  **Run as Administrator (Once):** The `start_app.bat` script will try to automatically configure the firewall for you, but it needs to be run as an administrator to do so. If you have connection problems, close the server window, then right-click `start_app.bat` and select **"Run as administrator"**. You only need to do this once.

2.  **Use the Correct URL:** Make sure you are using the correct network URL on your other device. The script will display it for you when it starts (e.g., `http://192.168.1.5:8081`). Do not use `127.0.0.1` or `localhost` on other devices. Your computer and phone must be on the same Wi-Fi network.

3.  **Manual Firewall Rule:** If running as an administrator doesn't work, you can create the firewall rule manually.
    1.  Press the **Windows Key**, type **Windows Defender Firewall with Advanced Security**, and press Enter.
    2.  In the left pane, click on **Inbound Rules**.
    3.  In the right pane, click on **New Rule...**.
    4.  Select **Port**, then **Next**.
    5.  Select **TCP**, enter **8081** for "Specific local ports", then **Next**.
    6.  Select **Allow the connection**, then **Next**.
    7.  Check the boxes for **Private** and **Public**, then **Next**.
    8.  Name the rule `SLR Work Permit App` and click **Finish**.
