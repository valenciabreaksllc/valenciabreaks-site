# Ops Command Hub - Agent Instructions

## Project
Ops Command Hub is Jonny Valencia's internal operations dashboard for Outerplanesgames.

It is a React/Vite frontend with Supabase, Vercel API routes, Make.com Gmail intake, and AI-assisted support workflows.

The app is internal only. It is not a customer-facing storefront.

## Main stack
- React / Vite
- Main app file: src/App.jsx
- Vercel API routes in api/
- Supabase backend
- Make.com handles Gmail intake
- Gmail labels route messages into Supabase

## Current visible pages
The sidebar should only show:
- Dashboard
- Command Inbox
- Replacements
- Inventory
- Surprise Sets
- Reports
- Settings

Old/hidden components may still exist. Do not delete them unless explicitly asked.

## Must not break
Do not break:
- Dashboard
- Command Inbox
- Check Gmail Now
- Refresh button
- AI triage
- AI drafts
- Process Queue
- Replacements
- Inventory
- Surprise Sets
- Reports
- Settings
- Supabase logic
- api/trigger-make-intake-refresh.js
- active tab localStorage safety
- inventory localStorage persistence

## Coding rules
- Patch safely.
- Do not rewrite the app.
- Do not split App.jsx into many files unless explicitly asked.
- Do not remove working features.
- Do not change database schema unless explicitly asked.
- Do not put Make webhook URLs or secrets into frontend code.
- Do not add useState, useEffect, or any React hook inside loops, maps, callbacks, conditionals, or nested render functions.
- All hooks must be top-level inside React components.
- Avoid emojis in the UI.
- The app should feel professional, like a Notion/Monday-style internal operations tool.
- Use Inter font and neutral slate/gray styling.

## Brand colors
- Vaulted: #FACC15
- PokeSpins: #DC2626
- CardKing47: #2563EB
- PokieMart: #16A34A
- Unknown/default: #CBD5E1
- Refund/return badges should be orange, not red.

## Workflow rules
- Customer replies must remain human-approved.
- Do not auto-send customer replies.
- Do not auto-issue refunds.
- Do not hard-delete records. Prefer archived_at.
- AI may classify, summarize, draft, prioritize, and suggest actions.
- Jonny approves customer-facing or money-related actions.

## Command Inbox rules
Command Inbox is the core workflow.

Do not break:
- Check Gmail Now
- Refresh
- Process Queue
- AI Triage
- Generate Draft
- Approve Draft
- Copy Draft
- Archive
- Message type badges

If adding card expand/collapse:
- Use top-level state inside CommandInboxView.
- Example: const [expandedMessages, setExpandedMessages] = useState({});
- Never use hooks inside .map() or inline nested functions.

## Testing
After code changes, run:
npm.cmd run build

If local testing is needed, run:
npm.cmd run start

Report:
- files changed
- build result
- risks
- what to manually test
