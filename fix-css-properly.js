const fs = require('fs');

let content = fs.readFileSync('index.html', 'utf8');

const plannerCSS = `
    /* Enhanced Planner Hub Styles */
    .planner-grid {
      display: grid;
      grid-template-columns: 60px 2fr 300px;
      gap: 16px;
      margin-bottom: 24px;
      min-height: 70vh;
    }

    .tool-rail {
      background: var(--page);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 16px 6px;
    }

    .rail-title {
      font-size: 10px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 16px;
      text-align: center;
    }

    .rail-link {
      display: block;
      padding: 10px 6px;
      text-align: center;
      color: var(--text);
      text-decoration: none;
      font-size: 11px;
      border-radius: 4px;
      margin-bottom: 6px;
      transition: all 0.2s ease;
    }

    .rail-link:hover {
      background: var(--bg);
      transform: translateY(-1px);
    }

    .planner-main {
      background: var(--page);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }

    .planner-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
      border-bottom: 1px solid var(--line);
      background: var(--bg);
    }

    .planner-header h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
    }

    .planner-nav {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 14px;
    }

    .btn-small {
      padding: 6px 12px;
      font-size: 11px;
      border: 1px solid var(--line);
      background: var(--page);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-small:hover {
      background: var(--bg);
      transform: translateY(-1px);
    }

    .weekly-grid {
      padding: 24px;
      overflow-x: auto;
      background: var(--page);
    }

    .calendar-table {
      width: 100%;
      border-collapse: collapse;
      font-size:13px;
      background: var(--page);
    }

    .calendar-table th,
    .calendar-table td {
      border: 1px solid var(--line);
      padding: 12px;
      text-align: left;
      vertical-align: top;
    }

    .calendar-table th {
      background: var(--bg);
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--muted);
      padding: 16px 12px;
    }

    .date-label {
      font-size: 10px;
      color: var(--muted);
      font-weight: 500;
    }

    .today-date {
      color: var(--red-text);
      font-weight: 700;
      background: rgba(255, 0, 0, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
    }

    .calendar-table .today-column {
      background: #fff8dc;
    }

    .calendar-cell {
      background: var(--page);
      border-radius: 6px;
      transition: all 0.2s ease;
    }

    .calendar-cell:hover {
      background: var(--bg);
      transform: translateY(-1px);
    }

    .time-label {
      font-weight: 500;
      margin-bottom: 8px;
      font-size: 11px;
      color: var(--muted);
    }

    .task-block {
      background: var(--page);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      transition: all 0.2s ease;
    }

    .task-block:hover {
      background: var(--bg);
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .task-name {
      font-weight: 600;
      margin-bottom: 8px;
      font-size: 13px;
      color: var(--text);
    }

    .task-actions {
      margin-bottom: 8px;
    }

    .task-checkbox {
      margin-right: 8px;
      transform: scale(1.1);
    }

    .task-label {
      font-size: 11px;
      cursor: pointer;
      color: var(--text);
    }

    .task-notes {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 6px;
      font-size: 11px;
      resize: none;
      min-height: 32px;
      background: rgba(255, 255, 255, 0.9);
      transition: all 0.2s ease;
    }

    .task-notes:focus {
      outline: 2px solid rgba(59, 130, 246, 0.5);
      outline-offset: 2px;
    }

    .right-panel {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .panel-section {
      background: var(--page);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--line);
      background: var(--bg);
    }

    .panel-header h4 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
    }

    .focus-content {
      padding: 20px;
      background: var(--page);
      border-radius: 6px;
    }

    .focus-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding: 12px;
      background: var(--page);
      border: 1px solid var(--line);
      border-radius: 6px;
    }

    .focus-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--muted);
    }

    .focus-value {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
    }

    .priorities-list {
      padding: 16px;
      max-height: 220px;
      overflow-y: auto;
      background: var(--page);
    }

    .priority-item {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      margin-bottom: 12px;
      font-size: 12px;
      background: var(--page);
      transition: all 0.2s ease;
    }

    .priority-item:hover {
      background: var(--bg);
      transform: translateY(-1px);
    }

    .priority-item:last-child {
      margin-bottom: 0;
    }

    .priority-header {
      font-weight: 600;
      margin-bottom: 6px;
      font-size: 12px;
      color: var(--text);
    }

    .priority-details {
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 6px;
    }

    .priority-pills {
      display: flex;
      gap: 6px;
      margin-bottom: 6px;
    }

    .priority-pill {
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 500;
    }

    .priority-urgent { background: var(--red); color: var(--red-text); }
    .priority-high { background: var(--orange); color: var(--orange-text); }
    .priority-medium { background: var(--yellow); color: var(--yellow-text); }
    .priority-low { background: var(--green); color: var(--green-text); }

    .status-new { background: var(--blue); color: var(--blue-text); }
    .status-in-progress { background: var(--yellow); color: var(--yellow-text); }
    .status-resolved { background: var(--green); color: var(--green-text); }

    .priority-action {
      font-size: 11px;
      color: var(--muted);
    }

    .prep-checklist {
      padding: 16px;
      background: var(--page);
    }

    .checklist-item {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
      font-size: 12px;
    }

    .checklist-item:last-child {
      margin-bottom: 0;
    }

    .checklist-item input[type="checkbox"] {
      margin-right: 10px;
      transform: scale(1.1);
    }

    .checklist-item label {
      cursor: pointer;
      font-size: 12px;
      color: var(--text);
    }

    .ai-actions {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: var(--page);
    }

    .ai-output {
      padding: 16px;
      min-height: 100px;
      font-size: 12px;
      color: var(--text);
      border-top: 1px solid var(--line);
      background: var(--page);
      white-space: pre-wrap;
    }

    .done-today-section {
      margin-top: 24px;
    }

    .done-card {
      background: var(--page);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }

    .done-card h4 {
      margin: 0 0 12px 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
    }

    .done-stats {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 16px;
    }

    .done-input {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
    }

    .done-input input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      font-size: 12px;
      background: rgba(255, 255, 255, 0.9);
      transition: all 0.2s ease;
    }

    .done-input input:focus {
      outline: 2px solid rgba(59, 130, 246, 0.5);
      outline-offset: 2px;
    }

    .done-notes {
      max-height: 140px;
      overflow-y: auto;
      background: var(--page);
      border-radius: 6px;
      padding: 12px;
    }

    .done-note {
      padding: 8px 12px;
      background: var(--bg);
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 8px;
      color: var(--text);
    }

    .done-note:last-child {
      margin-bottom: 0;
    }

    @media (max-width: 1200px) {
      .planner-grid {
        grid-template-columns: 50px 1fr 260px;
        gap: 12px;
      }
    }

    @media (max-width: 900px) {
      .planner-grid {
        grid-template-columns: 1fr;
        gap: 12px;
        min-height: auto;
      }
      
      .tool-rail {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 12px;
      }
      
      .rail-link {
        flex: 1;
        min-width: 50px;
        text-align: center;
      }
    }`;

// Find the closing style tag and insert CSS before it
const styleEndIndex = content.lastIndexOf('</style>');
if (styleEndIndex !== -1) {
    const beforeStyleEnd = content.substring(0, styleEndIndex);
    const afterStyleEnd = content.substring(styleEndIndex);
    
    // Insert planner CSS before closing style tag
    content = beforeStyleEnd + plannerCSS + afterStyleEnd;
    
    fs.writeFileSync('index.html', content);
    console.log('Successfully added planner CSS to existing style tag');
} else {
    console.log('Could not find closing style tag');
}
