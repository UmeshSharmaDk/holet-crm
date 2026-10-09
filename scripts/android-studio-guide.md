# Stay Pilot / Hotel CRM — Android Studio build guide

This is an Android Studio **source project**, not a compiled APK. It includes
the current guest-profile, identity-photo resizing, and booking PDF fixes.
No backend secrets, database exports, guest records, or identity scans are included.

## Before building

Install these on your computer:

- Node.js 22 LTS and npm. Verify `node --version` and `npm --version` in a terminal.
- A current Android Studio with its bundled JDK (Java 17 or later).
- In Android Studio's SDK Manager, install Android SDK Platform 36 and Build
  Tools 36.0.0. Allow Gradle to download NDK 27.1.12297006 and CMake 3.22.1 if
  requested, and accept the SDK licenses.
- Internet access for the first dependency installation and Gradle sync.

The APK supports Android 7.0 / API 24 and newer. A computer with at least 8 GB
RAM is recommended; native builds can need several GB of free disk space.

## 1. Make sure the backend is reachable

The `.env` file contains only the public backend hostname:

```
EXPO_PUBLIC_DOMAIN=hotel-management-system--umeshsharmadk.replit.app
```

Do not add `https://`, `/api`, or a trailing slash. The app adds those itself.
This value is built into the APK. Change it before building if you use a
different published backend.

**At preparation time, Replit reported this deployment as private.** A standalone
APK cannot pass Replit's collaborator sign-in gate using the CRM username and
password. Before using the APK, publish the latest backend fixes and make its
API reachable by Android clients, or point this file at another accessible
deployment of the same CRM backend. Changing deployment access is your decision;
this export does not publish anything or alter access.

Keep the CRM's own authentication, hotel permissions, and private encrypted
identity storage enabled. "Reachable backend" does not mean making guest
records or identity documents publicly accessible.

Never put database passwords, API keys, encryption keys, or signing passwords
in `.env`: `EXPO_PUBLIC_` values are visible in the built application.

## 2. Install JavaScript dependencies

Extract the ZIP, open a terminal in the `Hotel-CRM-Android` folder (the folder
containing `package.json`), and run:

```
npm ci
npm run typecheck
```

Keep `package-lock.json`; it pins the export's dependency graph. There are no
Replit workspace dependencies. Do not copy this project's files over your
running Replit application.

Optional JavaScript-only Android bundle check:

```
npm run bundle:android
```

This checks JavaScript/Hermes bundling, not native compilation or installation.
No Expo account or cloud-build service is required for these local steps.

## 3. Open the native Android project

In Android Studio select **Open**, then choose the extracted
`Hotel-CRM-Android/android` folder. Wait for Gradle sync to finish.

- The Gradle wrapper downloads Gradle 8.14.3 automatically.
- Use Android Studio's bundled JDK, Java 17 or newer.
- Set the Android SDK location if Studio requests it.
- If Gradle cannot find `node`, restart Android Studio after installing Node,
  or launch Studio from a terminal whose `PATH` can run `node --version`.

The Android identifier is **`com.staypilot.app`**, matching the current app
configuration. The launcher name is **Stay Pilot**. The initial version is
1.0.0 / version code 1. Keep the identifier and signing key unchanged for future
updates, and increase the version code for each new release.

## 4. Build an installable, signed APK

In Android Studio:

1. Choose **Build → Generate Signed Bundle / APK**.
2. Select **APK**, not Android App Bundle.
3. Select the `app` module.
4. Create your own signing keystore, or use your existing release keystore.
   Store it securely outside the extracted source folder. Keep a private backup
   of the keystore and its passwords; future updates require the same key.
5. Choose the **release** build variant and finish the wizard.
6. Use Studio's **Locate** link to find the generated `app-release.apk`. The
   exact folder is the destination chosen in the wizard, often `android/app/release`.

No release signing key is provided in this ZIP. The shared Expo template debug
keystore has been removed, and release builds do not use debug signing.
The normal Android Gradle debug configuration uses your computer's local debug
keystore if you build debug variants.

**Use the signed release APK for standalone use.** A normal debug APK generally
expects a running development bundler; an unsigned release APK cannot be
installed. The signed release build embeds JavaScript and assets and does not
need Expo Go or a running Replit preview.

Do not regenerate the native project with prebuild unless you intend to
reapply the signing changes in `android/app/build.gradle`.

## 5. Install and check on an Android phone

Copy the signed APK to your phone and open it. If Android requests permission
to install apps from that file manager, grant it only for this trusted file.

Sign in with your existing CRM account; no credentials are included in the
export. The app requires internet access to its CRM backend.

Before distributing the APK, check on a real Android device:

- Login and hotel-specific access.
- Creating and editing a booking with guest names, birth dates, and relations.
- Selecting large front/back identity photos, saving, and reopening the booking.
- Downloading/printing a booking PDF and confirming all identity photos appear.
- Any microphone, photo-picker, or location features you use.

## Verification already performed

- Standalone npm dependency installation completed.
- TypeScript check passed.
- Android JavaScript/Hermes bundle export passed with the current app source.
- Generated Android Studio project preserves the current Android identifier.

Native Gradle compilation, APK signing, and installation on a physical phone
were **not** performed in Replit because its workspace has no Android SDK/JDK.
The ZIP is the prepared project for completing those steps on your computer.
