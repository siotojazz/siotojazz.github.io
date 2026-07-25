# Competition data sync

Add public post and Reel URLs to `submissionLinksByTrack` in
`competition.json`, then run this command from the repository root:

```powershell
.\sync-competition.ps1
```

The first run installs Chromium if needed. Every run opens the submitted links,
reads the rendered likes and comments, and updates `competition.json`.

An Instagram session is optional. If anonymous loading is blocked, sign in
with a dedicated Instagram account and set its `sessionid` cookie for the
current terminal before running the script:

```powershell
$env:INSTAGRAM_SESSION_ID = "your-sessionid-cookie"
.\sync-competition.ps1
Remove-Item Env:INSTAGRAM_SESSION_ID
```

Never save the session cookie in the repository.
