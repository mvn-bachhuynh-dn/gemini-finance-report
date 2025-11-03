// =====================================================
// CONFIGURATION
// =====================================================
const BOT_TOKEN  = 'YOUR_TELEGRAM_TOKEN';
const GEMINI_KEY = 'YOUR_GEMINI_API_KEY';
const SHEET_ID   = 'YOUR_SHEET_ID';
const TG_API     = 'https://api.telegram.org/bot' + BOT_TOKEN;
const ADMIN_CHAT_ID = 'YOUR_CHAT_ID';
const REMIND_HOUR = 20;
const REPORT_HOUR = 21;

// =====================================================
// WEBHOOK ENTRY POINT
// =====================================================
function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    const msg = update.message;
    if (!msg || msg.from?.is_bot) return HtmlService.createHtmlOutput("ignored");

    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    if (!text) return HtmlService.createHtmlOutput("no text");

    const command = text.split('@')[0].toLowerCase();

    // =====================================================
    // BASIC COMMANDS
    // =====================================================
    if (command === "/start" || command === "/help") {
      ensureSheet();
      const helpText =
        "👋 Hello *" + (msg.from.first_name || "there") + "!*\n\n" +
        "I’m **Gemini Finance Bot v1** 💰 – your personal finance assistant.\n\n" +
        "🧾 Try typing naturally:\n" +
        "• `breakfast $5`\n• `bought coffee $2`\n• `received salary $1000`\n\n" +
        "📊 Quick commands:\n" +
        "• `/report` – Overall report\n" +
        "• `/reportday` – Today's report\n" +
        "• `/reportmonth` – Monthly report\n" +
        "• `/reportcategory` – Report by category\n" +
        "• `/topcategory` – Top spending category of the month\n" +
        "• `/undo` – Undo last transaction\n" +
        "• `/confirm` – Confirm deletion\n" +
        "• `/whoami` – View Chat ID\n\n" +
        "⏰ I’ll remind you to log expenses at " + REMIND_HOUR + ":00 and send daily reports at " + REPORT_HOUR + ":00.";
      sendMessage(chatId, helpText, "Markdown");
      return HtmlService.createHtmlOutput("ok");
    }

    if (command === "/whoami") {
      sendMessage(chatId, `🪪 Your Chat ID: <code>${chatId}</code>`, "HTML");
      return HtmlService.createHtmlOutput("ok");
    }

    if (["/report", "/reportday", "/reportmonth", "/reportcategory", "/topcategory"].includes(command)) {
      if (command === "/reportcategory") {
        sendMessage(chatId, getCategoryReport(), "HTML");
        return HtmlService.createHtmlOutput("ok");
      }
      if (command === "/topcategory") {
        sendMessage(chatId, getTopCategoryReport(), "HTML");
        return HtmlService.createHtmlOutput("ok");
      }
      let mode = "all";
      if (command === "/reportday") mode = "day";
      if (command === "/reportmonth") mode = "month";
      sendMessage(chatId, getFinanceReport(mode), "HTML");
      return HtmlService.createHtmlOutput("ok");
    }

    // =====================================================
    // UNDO + CONFIRM HANDLING (FIXED)
    // =====================================================
    if (command === "/undo") {
      const last = getLastTransaction();
      if (!last) {
        sendMessage(chatId, "⚠️ No recent transaction found to delete.");
        return HtmlService.createHtmlOutput("ok");
      }
      const confirmText =
        `❗ <b>Last transaction:</b>\n` +
        `📅 ${last.date}\n💬 ${last.note}\n💸 ${last.type} ${last.amount.toLocaleString()} USD (${last.category || "Uncategorized"})\n\n` +
        `Reply with <b>/confirm</b> to delete this transaction.`;
      sendMessage(chatId, confirmText, "HTML");
      return HtmlService.createHtmlOutput("ok");
    }

    if (command === "/confirm") {
      const deleted = deleteLastTransaction();
      sendMessage(chatId, deleted ? "✅ Last transaction deleted!" : "⚠️ Nothing to delete.");
      return HtmlService.createHtmlOutput("ok");
    }

    // =====================================================
    // AI-BASED NATURAL TRANSACTION HANDLING
    // =====================================================
    const parsed = parseAndReactWithGemini(text, msg.from.first_name || "User");
    if (!parsed?.amount || !parsed?.type) {
      sendMessage(chatId, "🤔 I couldn’t quite understand that transaction. Could you rephrase?");
      return HtmlService.createHtmlOutput("unclear");
    }

    appendToSheet(parsed, msg.from.first_name || "User");
    const reply = `✅ Recorded: <b>${parsed.type}</b> ${parsed.amount.toLocaleString()} USD — ${parsed.note || ""}\n🏷️ Category: <b>${parsed.category || "Other"}</b>\n\n${parsed.reaction}`;
    sendMessage(chatId, reply, "HTML");
    return HtmlService.createHtmlOutput("ok");

  } catch (err) {
    Logger.log("Error: " + err);
    return HtmlService.createHtmlOutput("error");
  }
}

// =====================================================
// GEMINI PARSER + CATEGORY + REACTION
// =====================================================
function parseAndReactWithGemini(text, userName) {
  try {
    const prompt = `
You are a friendly personal finance assistant who can categorize transactions.
Analyze the following user input about income or expenses.
Return a JSON object in this format:
{
  "type": "income" or "expense",
  "amount": amount in USD (integer),
  "note": "short description",
  "category": "category (e.g. Food, Transport, Entertainment, Bills, Shopping, Health, Other)",
  "reaction": "a natural, friendly, emotional reply with emojis"
}
User input: "${text}"
User name: "${userName}"
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
    const res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true,
    });

    const data = JSON.parse(res.getContentText());
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    Logger.log("Gemini parse error: " + e);
    return {};
  }
}

// =====================================================
// SHEET HANDLERS
// =====================================================
function ensureSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName("Transactions");
  if (!sh) {
    sh = ss.insertSheet("Transactions");
    sh.appendRow(["Timestamp", "User", "Type", "Amount (USD)", "Note", "Category"]);
  } else {
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (!headers.includes("Category")) {
      sh.insertColumnAfter(5);
      sh.getRange(1, 6).setValue("Category");
    }
  }
}

function appendToSheet(parsed, user) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions") || ss.insertSheet("Transactions");
  sh.appendRow([
    new Date(),
    user,
    parsed.type,
    parsed.amount,
    parsed.note || "",
    parsed.category || "Other"
  ]);
}

// =====================================================
// UNDO HANDLING (FIXED VERSION)
// =====================================================
function getLastTransaction() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions");
  if (!sh || sh.getLastRow() <= 1) return null;

  const lastRow = sh.getLastRow();
  const row = sh.getRange(lastRow, 1, 1, 6).getValues()[0];

  // Save lastRow index in Script Properties for /confirm
  PropertiesService.getScriptProperties().setProperty("LAST_UNDO_ROW", lastRow);

  return {
    date: row[0],
    user: row[1],
    type: row[2],
    amount: Number(row[3]),
    note: row[4],
    category: row[5]
  };
}

function deleteLastTransaction() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions");

  const lastRow = Number(PropertiesService.getScriptProperties().getProperty("LAST_UNDO_ROW"));
  if (!lastRow || lastRow <= 1 || !sh) return false;

  try {
    sh.deleteRow(lastRow);
    PropertiesService.getScriptProperties().deleteProperty("LAST_UNDO_ROW");
    return true;
  } catch (err) {
    Logger.log("Undo deletion error: " + err);
    return false;
  }
}

// =====================================================
// REPORTING FUNCTIONS
// =====================================================
function getFinanceReport(mode = "all") {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions");
  if (!sh) return "⚠️ No data available.";
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return "📭 No transactions recorded yet.";

  const today = new Date();
  const d = today.getDate(), m = today.getMonth(), y = today.getFullYear();
  let income = 0, expense = 0;

  for (let i = 1; i < data.length; i++) {
    const [ts, , type, amt] = data[i];
    if (!ts || !type || !amt) continue;
    const date = new Date(ts);
    if (mode === "day" && (date.getDate() !== d || date.getMonth() !== m || date.getFullYear() !== y)) continue;
    if (mode === "month" && (date.getMonth() !== m || date.getFullYear() !== y)) continue;
    if (type.toLowerCase() === "income") income += amt;
    if (type.toLowerCase() === "expense") expense += amt;
  }

  const balance = income - expense;
  const emoji = balance >= 0 ? "🟢" : "🔴";
  const title = mode === "day" ? "📅 <b>Today's Report</b>" : mode === "month" ? "🗓️ <b>This Month's Report</b>" : "📊 <b>Overall Report</b>";
  return `${title}\n\n💰 <b>Total Income:</b> ${income.toLocaleString()} USD\n💸 <b>Total Expense:</b> ${expense.toLocaleString()} USD\n${emoji} <b>Balance:</b> ${balance.toLocaleString()} USD\n\n${balance >= 0 ? "Nice job managing your money 😎" : "Spending a bit high today 😅"}`;
}

function getCategoryReport() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions");
  if (!sh || sh.getLastRow() <= 1) return "📭 No data found.";
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const totals = {};

  data.forEach(row => {
    const [ , , type, amt, , category ] = row;
    if (type.toLowerCase() === "expense")
      totals[category] = (totals[category] || 0) + Number(amt || 0);
  });

  const entries = Object.entries(totals);
  if (entries.length === 0) return "📭 No expense records yet.";
  entries.sort((a, b) => b[1] - a[1]);

  let result = "🏷️ <b>Expense by Category</b>\n\n";
  entries.forEach(([cat, val]) => result += `• ${cat}: ${val.toLocaleString()} USD\n`);
  return result;
}

function getTopCategoryReport() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions");
  if (!sh || sh.getLastRow() <= 1) return "📭 No expense data yet.";

  const today = new Date();
  const m = today.getMonth(), y = today.getFullYear();
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const totals = {};

  data.forEach(row => {
    const [ts, , type, amt, , category] = row;
    const date = new Date(ts);
    if (type.toLowerCase() === "expense" && date.getMonth() === m && date.getFullYear() === y) {
      totals[category] = (totals[category] || 0) + Number(amt || 0);
    }
  });

  const entries = Object.entries(totals);
  if (entries.length === 0) return "📭 No expenses recorded this month.";
  entries.sort((a, b) => b[1] - a[1]);

  const total = entries.reduce((sum, e) => sum + e[1], 0);
  const [topCat, topVal] = entries[0];
  const percent = ((topVal / total) * 100).toFixed(1);

  return `📈 <b>Top Spending Category This Month</b>\n\n🥇 <b>${topCat}</b>: ${topVal.toLocaleString()} USD\nAbout ${percent}% of total expenses.\n\nKeep up the good financial habits 💪`;
}

// =====================================================
// TELEGRAM HANDLER
// =====================================================
function sendMessage(chatId, text, mode = "HTML", buttons = null) {
  const payload = { chat_id: chatId, text, parse_mode: mode };
  if (buttons) payload.reply_markup = { inline_keyboard: buttons };
  UrlFetchApp.fetch(`${TG_API}/sendMessage`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

// =====================================================
// DAILY JOBS
// =====================================================
function dailyReminderJob() {
  const message = "💡 Time to log your expenses!\nHave you added your income/expenses today? 📝";
  const buttons = [[{ text: "📊 Today's Report", callback_data: "/reportday" }, { text: "🧾 Add Now", callback_data: "/start" }]];
  sendMessage(ADMIN_CHAT_ID, message, "Markdown", buttons);
}

function dailyReportJob() {
  const report = getFinanceReport("day");
  sendMessage(ADMIN_CHAT_ID, "⏰ 21:00 – Daily Report:\n\n" + report, "HTML");
}

function doGet() {
  return HtmlService.createTextOutput("✅ Gemini Finance Bot v1 is running normally.");
}
