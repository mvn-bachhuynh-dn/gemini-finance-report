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
    let text = msg.text?.trim();
    let imageBlob = null;

    Logger.log(`Received message from ${chatId}. Text: "${text}". Photo present: ${!!msg.photo}`);

    // Check for photo
    if (msg.photo && msg.photo.length > 0) {
      // Get the largest photo
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      Logger.log(`Found photo with ID: ${photoId}`);
      imageBlob = getTelegramFile(photoId);
      if (!imageBlob) {
        sendMessage(chatId, "⚠️ Lỗi: Không thể tải ảnh từ Telegram. Vui lòng thử lại.");
        return HtmlService.createHtmlOutput("image download failed");
      }
      Logger.log(`Image blob retrieved: ${imageBlob ? imageBlob.getContentType() : "null"}`);
      if (!text) text = msg.caption || "Phân tích ảnh này";
    }

    if (!text && !imageBlob) {
      Logger.log("No text and no image blob found. Exiting.");
      return HtmlService.createHtmlOutput("no content");
    }

    const command = text.split('@')[0].toLowerCase();
    Logger.log(`Command detected: ${command}`);

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
    const parsed = parseAndReactWithGemini(text, msg.from.first_name || "Người dùng", imageBlob);
    
    // Debug: If parsed has error or raw, show it
    if (parsed.error) {
       const safeError = (parsed.error || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
       const safeRaw = (parsed.raw || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
       sendMessage(chatId, `⚠️ <b>Lỗi xử lý AI:</b>\n${safeError}\n\n<b>Raw Output:</b>\n<pre>${safeRaw}</pre>`, "HTML");
       return HtmlService.createHtmlOutput("ai error");
    }

    // Dispatch based on intent
    // Dispatch based on intent
    let intent = parsed.intent;
    let data = parsed.data || {};

    // FALLBACK: If model returns flat JSON (old format or hallucination)
    if (!intent) {
       if (parsed.amount && parsed.type) {
          intent = "transaction";
          data = parsed;
          Logger.log("Fallback: Detected flat JSON transaction.");
       } else if (parsed.report_type) {
          intent = "report";
          data = parsed;
       } else {
          intent = "chat";
          Logger.log("Fallback: Defaulting to chat.");
       }
    }

    // --- CASE 1: REPORT ---
    if (intent === "report") {
      let reportContent = "";
      switch (data.report_type) {
        case "day": reportContent = getFinanceReport("day"); break;
        case "month": reportContent = getFinanceReport("month"); break;
        case "category": reportContent = getCategoryReport(); break;
        case "top_category": reportContent = getTopCategoryReport(); break;
        default: reportContent = getFinanceReport("all"); break;
      }
      sendMessage(chatId, `${parsed.reaction}\n\n${reportContent}`, "HTML");
      return HtmlService.createHtmlOutput("ok report");
    }

    // --- CASE 2: TRANSACTION ---
    if (intent === "transaction") {
      if (!data.amount || !data.type) {
         sendMessage(chatId, "🤔 (v2) Hình như bạn muốn ghi giao dịch nhưng mình chưa rõ số tiền. Bạn nói lại rõ hơn nhé?");
         return HtmlService.createHtmlOutput("transaction unclear");
      }
      appendToSheet(data, msg.from.first_name || "User");
      const reply = `✅ Đã ghi: <b>${data.type}</b> ${data.amount.toLocaleString()}đ — ${data.note || ""}\n🏷️ Danh mục: <b>${data.category || "Khác"}</b>\n\n${parsed.reaction}`;
      sendMessage(chatId, reply, "HTML");
      return HtmlService.createHtmlOutput("ok transaction");
    }

    // --- CASE 3: CHAT / OTHER ---
    // Default to just sending the reaction
    sendMessage(chatId, parsed.reaction || "Mình đang lắng nghe đây! 😄", "HTML");
    return HtmlService.createHtmlOutput("ok chat");

  } catch (err) {
    Logger.log("Error: " + err);
    try {
      const update = JSON.parse(e.postData.contents);
      const chatId = update.message.chat.id;
      sendMessage(chatId, `🔥 <b>Lỗi hệ thống:</b>\n${err.toString()}`, "HTML");
    } catch (e2) {
      Logger.log("Could not send error to user: " + e2);
    }
    return HtmlService.createHtmlOutput("error");
  }
}

// =====================================================
// GEMINI PARSER HANDLER
// =====================================================
function parseAndReactWithGemini(text, userName, imageBlob = null) {
  Logger.log(`parseAndReactWithGemini called. User: ${userName}, Text: ${text}, Has Image: ${!!imageBlob}`);
  try {
    const prompt = `
Bạn là "Bot Chi Tiêu Gemini", một trợ lý tài chính cá nhân thông minh, vui tính và hữu ích.
Nhiệm vụ của bạn là phân tích tin nhắn của người dùng (và ảnh nếu có) để xác định xem họ muốn:
1. Ghi chép giao dịch (thu/chi).
2. Xem báo cáo tài chính.
3. Trò chuyện xã giao bình thường.

Trả về kết quả dưới dạng JSON KHÔNG CÓ MARKDOWN (không dùng \`\`\`json).
Cấu trúc JSON yêu cầu:

{
  "intent": "transaction" | "report" | "chat",
  "data": {
     // NẾU intent = "transaction":
     "type": "thu" hoặc "chi",
     "amount": số tiền (VNĐ, integer),
     "note": "mô tả ngắn gọn nội dung chi tiêu",
     "category": "danh mục (Ăn uống, Di chuyển, Mua sắm, Hóa đơn, Giải trí, Sức khỏe, Giáo dục, Đầu tư, Khác)"

     // NẾU intent = "report":
     "report_type": "day" | "month" | "all" | "category" | "top_category" (dựa vào ngữ cảnh thời gian user hỏi)
  },
  "reaction": "Câu trả lời của bạn với người dùng. Nếu là chat thì trả lời tự nhiên. Nếu là giao dịch/report thì trả lời xác nhận vui vẻ. Dùng nhiều emoji."
}

Câu của người dùng: "${text}"
Tên người dùng: "${userName}"
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
    
    let payload = {
      contents: [{
        parts: [{ text: prompt }]
      }]
    };

    if (imageBlob) {
      Logger.log("Adding image to payload...");
      payload.contents[0].parts.push({
        inline_data: {
          mime_type: imageBlob.getContentType(),
          data: Utilities.base64Encode(imageBlob.getBytes())
        }
      });
    }

    Logger.log("Sending request to Gemini...");
    const res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const responseCode = res.getResponseCode();
    const contentText = res.getContentText();
    Logger.log(`Gemini response code: ${responseCode}`);
    Logger.log(`Gemini response body: ${contentText}`);

    if (responseCode !== 200) {
      return { error: `API Error: ${responseCode}`, raw: contentText };
    }

    const data = JSON.parse(contentText);
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!raw) {
       return { error: "No content in candidate", raw: contentText };
    }

    Logger.log(`Raw extracted text: ${raw}`);
    
    let jsonString = raw;
    
    // Try to extract JSON from code block
    const codeBlockMatch = raw.match(/```json([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      jsonString = codeBlockMatch[1];
    } else {
      // Fallback: Find first '{' and last '}'
      const firstBrace = raw.indexOf('{');
      const lastBrace = raw.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonString = raw.substring(firstBrace, lastBrace + 1);
      }
    }

    try {
      return JSON.parse(jsonString.trim());
    } catch (parseErr) {
      return { error: "JSON Parse Error: " + parseErr.message, raw: raw };
    }
  } catch (e) {
    Logger.log("Gemini parse error: " + e);
    return { error: "Exception: " + e.toString(), raw: "Check logs" };
  }
}

function getTelegramFile(fileId) {
  Logger.log(`getTelegramFile called for ID: ${fileId}`);
  try {
    const url = `${TG_API}/getFile?file_id=${fileId}`;
    const res = UrlFetchApp.fetch(url);
    const data = JSON.parse(res.getContentText());
    if (data.ok) {
      const filePath = data.result.file_path;
      Logger.log(`File path retrieved: ${filePath}`);
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
      const blob = UrlFetchApp.fetch(fileUrl).getBlob();
      
      // Fix MIME type if it is generic
      if (blob.getContentType() === "application/octet-stream") {
        if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) {
          blob.setContentType("image/jpeg");
        } else if (filePath.endsWith(".png")) {
          blob.setContentType("image/png");
        } else if (filePath.endsWith(".webp")) {
          blob.setContentType("image/webp");
        }
      }
      
      Logger.log(`Blob retrieved. Size: ${blob.getBytes().length}, Type: ${blob.getContentType()}`);
      return blob;
    } else {
      Logger.log(`Error getting file path: ${JSON.stringify(data)}`);
    }
  } catch (e) {
    Logger.log("Error getting Telegram file: " + e);
  }
  return null;
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
