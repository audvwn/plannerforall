# Firebase setup

1. Create a Firebase project and register a Web app.
2. Copy its config values into `firebase-config.js`.
3. In **Authentication > Sign-in method**, enable Google and/or Email/Password.
4. In **Firestore Database**, create a database and deploy rules like:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/planner/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
  }
}
```

5. Add each hosted domain in **Authentication > Settings > Authorized domains**.

The app remains fully usable with localStorage when Firebase is missing, offline,
blocked, or misconfigured. Cloud records are stored at
`users/{uid}/planner/main`; users cannot access one another's planner when the
rules above are active.

## Hosting

The project uses relative asset paths and works from a local web server, GitHub
Pages, or Firebase Hosting. Do not open it only through `file://` when testing
Firebase authentication; serve the folder over HTTP instead.
