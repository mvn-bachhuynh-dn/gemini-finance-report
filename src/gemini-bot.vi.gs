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
        "👋 Xin chào *" + (msg.from.first_name || "bạn") + "!*\n\n" +
        "Tôi là **Bot Chi Tiêu Gemini v1** 💰 – trợ lý tài chính cá nhân của bạn.\n\n" +
        "📘 Gõ tự nhiên:\n" +
        "• `ăn sáng 35k`\n• `mua cà phê 25k`\n• `nhận lương 10 triệu`\n\n" +
        "📊 Lệnh nhanh:\n" +
        "• `/report` – Báo cáo tổng hợp\n" +
        "• `/reportday` – Báo cáo hôm nay\n" +
        "• `/reportmonth` – Báo cáo tháng\n" +
        "• `/reportcategory` – Báo cáo theo danh mục\n" +
        "• `/topcategory` – Danh mục chi tiêu lớn nhất tháng\n" +
        "• `/undo` – Xoá giao dịch gần nhất\n" +
        "• `/confirm` – Xác nhận xoá\n" +
        "• `/whoami` – Xem Chat ID\n\n" +
        "⏰ Tôi sẽ nhắc bạn ghi chi tiêu lúc " + REMIND_HOUR + ":00 và gửi báo cáo lúc " + REPORT_HOUR + ":00 mỗi ngày.";
      sendMessage(chatId, helpText, "Markdown");
      return HtmlService.createHtmlOutput("ok");
    }

    if (command === "/whoami") {
      sendMessage(chatId, `🪪 Chat ID của bạn là: <code>${chatId}</code>`, "HTML");
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
    // UNDO + CONFIRM FEATURE (FIXED)
    // =====================================================
    if (command === "/undo") {
      const last = getLastTransaction();
      if (!last) {
        sendMessage(chatId, "⚠️ Không tìm thấy giao dịch nào để xoá.");
        return HtmlService.createHtmlOutput("ok");
      }
      const confirmText =
        `❗ <b>Giao dịch gần nhất:</b>\n` +
        `📅 ${last.date}\n💬 ${last.note}\n💸 ${last.type} ${last.amount.toLocaleString()}đ (${last.category || "Chưa phân loại"})\n\n` +
        `Gõ <b>/confirm</b> để xác nhận xoá.`;
      sendMessage(chatId, confirmText, "HTML");
      return HtmlService.createHtmlOutput("ok");
    }

    if (command === "/confirm") {
      const deleted = deleteLastTransaction();
      sendMessage(chatId, deleted ? "✅ Đã xoá giao dịch gần nhất!" : "⚠️ Không có gì để xoá.");
      return HtmlService.createHtmlOutput("ok");
    }

    // =====================================================
    // AI-BASED TRANSACTION PARSING (GEMINI)
    // =====================================================
    const parsed = parseAndReactWithGemini(text, msg.from.first_name || "Người dùng");
    if (!parsed?.amount || !parsed?.type) {
      sendMessage(chatId, "🤔 Tôi chưa hiểu rõ giao dịch này, bạn thử diễn đạt khác nhé?");
      return HtmlService.createHtmlOutput("unclear");
    }

    appendToSheet(parsed, msg.from.first_name || "User");
    const reply = `✅ Đã ghi: <b>${parsed.type}</b> ${parsed.amount.toLocaleString()}đ — ${parsed.note || ""}\n🏷️ Danh mục: <b>${parsed.category || "Khác"}</b>\n\n${parsed.reaction}`;
    sendMessage(chatId, reply, "HTML");
    return HtmlService.createHtmlOutput("ok");

  } catch (err) {
    Logger.log("Error: " + err);
    return HtmlService.createHtmlOutput("error");
  }
}

// =====================================================
// GEMINI PARSER HANDLER
// =====================================================
function parseAndReactWithGemini(text, userName) {
  try {
    const prompt = `
Bạn là trợ lý tài chính cá nhân thân thiện, có khả năng phân loại chi tiêu.
Phân tích câu người dùng nhập về chi tiêu hoặc thu nhập.
Trả về JSON theo mẫu:
{
  "type": "thu" hoặc "chi",
  "amount": số tiền (VNĐ, integer),
  "note": "mô tả ngắn",
  "category": "danh mục (ví dụ: Ăn uống, Di chuyển, Giải trí, Hóa đơn, Mua sắm, Sức khỏe, Khác)",
  "reaction": "một câu phản hồi tự nhiên, vui vẻ, thân mật, có emoji"
}
Câu của người dùng: "${text}"
Tên người dùng: "${userName}"
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
// GOOGLE SHEETS HANDLER
// =====================================================
function ensureSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName("Transactions");
  if (!sh) {
    sh = ss.insertSheet("Transactions");
    sh.appendRow(["Thời gian", "Người dùng", "Loại", "Số tiền", "Ghi chú", "Danh mục"]);
  } else {
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (!headers.includes("Danh mục")) {
      sh.insertColumnAfter(5);
      sh.getRange(1, 6).setValue("Danh mục");
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
    parsed.category || "Khác"
  ]);
}

// =====================================================
// UNDO / CONFIRM (FIXED VERSION)
// =====================================================
function getLastTransaction() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions");
  if (!sh || sh.getLastRow() <= 1) return null;

  const lastRow = sh.getLastRow();
  const row = sh.getRange(lastRow, 1, 1, 6).getValues()[0];

  // Save the last row index in Script Properties to allow confirmation deletion
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
  if (!sh) return "⚠️ Chưa có dữ liệu nào.";
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return "📭 Chưa ghi nhận giao dịch nào.";

  const today = new Date();
  const d = today.getDate(), m = today.getMonth(), y = today.getFullYear();
  let totalThu = 0, totalChi = 0;

  for (let i = 1; i < data.length; i++) {
    const [ts, , type, amt] = data[i];
    if (!ts || !type || !amt) continue;
    const date = new Date(ts);
    if (mode === "day" && (date.getDate() !== d || date.getMonth() !== m || date.getFullYear() !== y)) continue;
    if (mode === "month" && (date.getMonth() !== m || date.getFullYear() !== y)) continue;
    if (type === "thu") totalThu += amt;
    if (type === "chi") totalChi += amt;
  }

  const balance = totalThu - totalChi;
  const emoji = balance >= 0 ? "🟢" : "🔴";
  const title = mode === "day" ? "📅 <b>Báo cáo hôm nay</b>" : mode === "month" ? "🗓️ <b>Báo cáo tháng này</b>" : "📊 <b>Báo cáo tổng hợp</b>";
  return `${title}\n\n💰 <b>Tổng thu:</b> ${totalThu.toLocaleString()}đ\n💸 <b>Tổng chi:</b> ${totalChi.toLocaleString()}đ\n${emoji} <b>Cân đối:</b> ${balance.toLocaleString()}đ\n\n${balance >= 0 ? "Tài chính ổn áp đó nha 😎" : "Chi hơi mạnh tay rồi 😅"}`;
}

function getCategoryReport() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions");
  if (!sh || sh.getLastRow() <= 1) return "📭 Chưa có dữ liệu nào.";
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const totals = {};

  data.forEach(row => {
    const [ , , type, amt, , category ] = row;
    if (type === "chi") totals[category] = (totals[category] || 0) + Number(amt || 0);
  });

  const entries = Object.entries(totals);
  if (entries.length === 0) return "📭 Chưa có giao dịch chi tiêu nào.";
  entries.sort((a, b) => b[1] - a[1]);

  let result = "🏷️ <b>Báo cáo theo danh mục chi tiêu</b>\n\n";
  entries.forEach(([cat, val]) => result += `• ${cat}: ${val.toLocaleString()}đ\n`);
  return result;
}

function getTopCategoryReport() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions");
  if (!sh || sh.getLastRow() <= 1) return "📭 Chưa có dữ liệu chi tiêu.";

  const today = new Date();
  const m = today.getMonth(), y = today.getFullYear();
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const totals = {};

  data.forEach(row => {
    const [ts, , type, amt, , category] = row;
    const date = new Date(ts);
    if (type === "chi" && date.getMonth() === m && date.getFullYear() === y) {
      totals[category] = (totals[category] || 0) + Number(amt || 0);
    }
  });

  const entries = Object.entries(totals);
  if (entries.length === 0) return "📭 Tháng này chưa có chi tiêu nào.";
  entries.sort((a, b) => b[1] - a[1]);

  const total = entries.reduce((sum, e) => sum + e[1], 0);
  const [topCat, topVal] = entries[0];
  const percent = ((topVal / total) * 100).toFixed(1);

  return `📈 <b>Danh mục chi tiêu nhiều nhất tháng này</b>\n\n🥇 <b>${topCat}</b>: ${topVal.toLocaleString()}đ\nChiếm khoảng ${percent}% tổng chi tiêu.\n\nTiếp tục quản lý tốt nhé 💪`;
}

// =====================================================
// TELEGRAM MESSAGE SENDER
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
// DAILY AUTOMATION JOBS
// =====================================================
function dailyReminderJob() {
  const message = "💡 Đến giờ ghi chi tiêu rồi đó!\nBạn đã thêm khoản chi/thu nào hôm nay chưa? 📝";
  const buttons = [[{ text: "📊 Báo cáo hôm nay", callback_data: "/reportday" }, { text: "🧾 Ghi ngay", callback_data: "/start" }]];
  sendMessage(ADMIN_CHAT_ID, message, "Markdown", buttons);
}

function dailyReportJob() {
  const report = getFinanceReport("day");
  sendMessage(ADMIN_CHAT_ID, "⏰ 21:00 – Báo cáo ngày:\n\n" + report, "HTML");
}

function doGet() {
  return HtmlService.createTextOutput("✅ Bot Chi Tiêu Gemini v1 đang chạy bình thường.");
}
