# Firebase security rules

MathBattles.io uses Firebase **only for sign-in**. Game data lives in the game's own server
(Cloudflare D1), never in a Firebase database, so every Firebase database and storage bucket
should refuse everything.

## Realtime Database

The project has a Realtime Database (`mathbattles-98eee-default-rtdb`) that the game never uses.
Lock it with the rules in `database.rules.json`:

1. Open https://console.firebase.google.com/project/mathbattles-98eee/database/mathbattles-98eee-default-rtdb/rules
2. Replace the rules with the contents of `database.rules.json`.
3. Click **Publish**.

Check it worked: https://mathbattles-98eee-default-rtdb.firebaseio.com/.json should answer
`Permission denied` instead of `null`.

## Firestore and Storage

Neither is set up for this project. If either is ever created, set its rules to deny all too.
