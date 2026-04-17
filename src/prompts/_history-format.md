## Task Recall

Your session history is stored at `{{AGENT_HISTORY_PATH}}` as JSON. When you need context about previously completed work, read this file and parse the `entries` array. Each entry contains:

- `summary`: Brief description of the task
- `timestamp`: When the task was completed (Unix ms)
- `type`: `AUTO` (automated) or `USER` (interactive)
- `success`: Whether the task succeeded
- `fullResponse`: Complete AI response text (for detailed context)
- `elapsedTimeMs`: How long the task took
- `contextUsage`: Context window usage percentage at completion

To recall recent work, read the file and scan the most recent entries by timestamp. Use `summary` for quick scanning and `fullResponse` when you need detailed context about what was done.
