// =====================================================
// WEBHOOK ENTRY POINT
// =====================================================
function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    const msg = update.message;
    if (!msg || msg.from?.is_bot) return HtmlService.createHtmlOutput("ignored");

    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    let text = msg.text?.trim();
    let imageBlob = null;

    // 1. React "Loading" immediately
    setMessageReaction(chatId, messageId, "👀");


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
    // Pass chatId to allow debugging messages
    const parsed = parseAndReactWithGemini(chatId, text, msg.from.first_name || "Người dùng", imageBlob);
    
    // Debug: If parsed has error or raw, show it
    if (parsed.error) {
       const safeError = (parsed.error || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, ">");
       const safeRaw = (parsed.raw || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, ">");
       sendMessage(chatId, `⚠️ <b>Lỗi xử lý AI:</b>\n${safeError}\n\n<b>Raw Output:</b>\n<pre>${safeRaw}</pre>`, "HTML");
       return HtmlService.createHtmlOutput("ai error");
    }

    // Dispatch based on intent
    // Dispatch based on intent
    let intent = parsed.intent;
    let data = parsed.data || parsed; // Support both nested 'data' and flat JSON

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
        case "year": reportContent = getFinanceReport("year"); break;
        case "category": 
          // Check if specific category requested
          reportContent = getCategoryReport(data.category); 
          break;
        case "top_category": reportContent = getTopCategoryReport(); break;
        default: reportContent = getFinanceReport("all"); break;
      }
      sendMessage(chatId, `${parsed.reaction}\n\n${reportContent}`, "HTML");
      setMessageReaction(chatId, messageId, "👌");
      return HtmlService.createHtmlOutput("ok report");
    }

    // --- CASE 2: TRANSACTION ---
    if (intent === "transaction") {
      if (!data.amount || !data.type) {
         sendMessage(chatId, "🤔 (v2) Hình như bạn muốn ghi giao dịch nhưng mình chưa rõ số tiền. Bạn nói lại rõ hơn nhé?");
         setMessageReaction(chatId, messageId, "🤔");
         return HtmlService.createHtmlOutput("transaction unclear");
      }
      appendToSheet(data, msg.from.first_name || "User");
      
      // Calculate Stats
      const stats = calculateMonthlyStats(data.category);
      
      let statsText = `• ${data.category}: ${stats.totalDetailed.toLocaleString()}đ\n`;
      
      // If group detected and different from detailed, show group stats
      if (stats.detectedGroupName && stats.totalGroup > 0) {
         statsText += `• Nhóm ${stats.detectedGroupName}: ${stats.totalGroup.toLocaleString()}đ\n`;
      }
      
      statsText += `• Tổng chi: ${stats.totalMonth.toLocaleString()}đ\n\n`;

      let dateInfo = "";
      if (data.date) {
         const pDate = new Date(data.date);
         if (!isNaN(pDate.getTime())) {
            dateInfo = `📅 Ngảy: ${pDate.toLocaleDateString("vi-VN")}\n`;
         }
      }

      const reply = `✅ Đã ghi: <b>${data.type}</b> ${data.amount.toLocaleString()}đ — ${data.note || ""}\n${dateInfo}🏷️ Danh mục: <b>${data.category || "Khác"}</b>\n\n` + 
                    `📈 <b>Tháng này:</b>\n` +
                    statsText +
                    `${parsed.reaction}`;
                    
      sendMessage(chatId, reply, "HTML");
      
      // React based on category
      let reactEmoji = "✍";
      const cat = (data.category || "").toLowerCase();
      if (cat.includes("ăn") || cat.includes("uống")) reactEmoji = "🌭";
      else if (cat.includes("thuốc") || cat.includes("sức khỏe") || cat.includes("khám")) reactEmoji = "💊";
      else if (cat.includes("việc") || cat.includes("làm")) reactEmoji = "🤝";
      else if (cat.includes("chơi") || cat.includes("giải trí")) reactEmoji = "🎉";
      else if (cat.includes("xe") || cat.includes("di chuyển") || cat.includes("xăng")) reactEmoji = "🕊"; 
      else if (cat.includes("mua") || cat.includes("sắm")) reactEmoji = "💅";

      setMessageReaction(chatId, messageId, reactEmoji);
      return HtmlService.createHtmlOutput("ok transaction");
    }

    // --- CASE 3: DELETE ---
    if (intent === "delete") {
      if (!data.amount || !data.type) {
        sendMessage(chatId, "🤔 Mình cần biết rõ số tiền và loại giao dịch (thu/chi) để xóa. Bạn nói rõ hơn nhé?");
        setMessageReaction(chatId, messageId, "🤔");
        return HtmlService.createHtmlOutput("delete unclear");
      }
      const success = deleteTransactionByCriteria(data);
      if (success) {
        sendMessage(chatId, `🗑️ ${parsed.reaction || "Đã xóa giao dịch!"}\n\nĐã xóa khoản <b>${data.type} ${data.amount.toLocaleString()}đ</b> gần nhất.`, "HTML");
        setMessageReaction(chatId, messageId, "👌");
      } else {
        sendMessage(chatId, `⚠️ Không tìm thấy giao dịch <b>${data.type} ${data.amount.toLocaleString()}đ</b> nào gần đây để xóa.`, "HTML");
        setMessageReaction(chatId, messageId, "🤔");
      }
      return HtmlService.createHtmlOutput("ok delete");
    }

    // --- CASE 4: CHAT / OTHER ---
    // Default to just sending the reaction
    sendMessage(chatId, parsed.reaction || "Mình đang lắng nghe đây! 😄", "HTML");
    setMessageReaction(chatId, messageId, "👌");
    return HtmlService.createHtmlOutput("ok chat");
  } catch (err) {
// ... (unchanged) ...
  }
}

// =====================================================
// GEMINI PARSER HANDLER
// =====================================================
function parseAndReactWithGemini(chatId, text, userName, imageBlob = null) {
  Logger.log(`parseAndReactWithGemini called. User: ${userName}, Text: ${text}, Has Image: ${!!imageBlob}`);
  try {
    const now = new Date();
    const currentDateString = now.toLocaleDateString("vi-VN", { weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric' });
    
    const prompt = `
Bạn là "Bot Chi Tiêu Gemini", một trợ lý tài chính cá nhân thông minh, vui tính.
Hôm nay là: ${currentDateString}.
Tuy nhiệm vụ chính là quản lý chi tiêu, bạn CÓ THỂ trò chuyện vui vẻ và trả lời các câu hỏi kiến thức chung (giá vàng, thời tiết, tin tức...) một cách ngắn gọn, hữu ích.

Nhiệm vụ của bạn là phân tích tin nhắn người dùng (và ảnh) để xác định intent:

1. \`transaction\`: Ghi chép thu/chi.
2. \`report\`: Xem báo cáo.
   - Nếu hỏi chung: report_type="day"/"month"/"year"/"all".
   - Nếu hỏi danh mục cụ thể (vd: "đã tiêu bao nhiêu cho ăn uống"): report_type="category", category="Ăn uống" (trích xuất từ khoá).
3. \`delete\`: Xóa giao dịch (ví dụ: "xóa khoản thu 120k").
4. \`chat\`: Trò chuyện xã giao HOẶC hỏi đáp kiến thức chung.

Yêu cầu QUAN TRỌNG về JSON:
- Trả về JSON chuẩn (RFC 8259).
- BẮT BUỘC dùng dấu ngoặc kép (") cho tên trường (key) và giá trị chuỗi (string value).
- Nếu trong nội dung chuỗi có dấu ngoặc kép, hãy escape nó bằng dấu gạch chéo ngược (\"). Ví dụ: "reaction": "Chào \"bạn\" nhé"
Bạn là trợ lý tài chính cá nhân thân thiện, có khả năng phân loại chi tiêu cực kỳ chi tiết.
Phân tích câu người dùng nhập (và hình ảnh nếu có) về chi tiêu hoặc thu nhập.
- Nếu là giao dịch: Phân loại chi tiết.
- Nếu là câu hỏi chung (không phải ghi chép): Set intent="chat" và trả lời câu hỏi đó trong field "reaction".
Mặc định "type" là "chi" nếu không có thông tin rõ ràng về việc thu tiền.
QUAN TRỌNG: Hãy tìm thông tin NGÀY THÁNG trong câu nói hoặc trên ảnh hóa đơn (nếu có).
- Ví dụ: "Hôm qua ăn 30k" -> Tính ra ngày hôm qua dựa trên "Hôm nay là: ${currentDateString}".
- Ví dụ: Ảnh hóa đơn có ngày "2023-12-01" -> Trích xuất ngày này.
- Trả về field "date" định dạng "YYYY-MM-DD" (ISO 8601). Nếu không tìm thấy, không cần trả về field này.

YÊU CẦU QUAN TRỌNG VỀ DANH MỤC (CATEGORY):
Hãy cố gắng classify vào các nhánh nhỏ chi tiết nhất có thể để phục vụ thống kê (KHÔNG dùng category chung chung):
1. Ăn uống: Bắt buộc dùng "Ăn sáng", "Ăn trưa", "Ăn tối", "Ăn vặt", "Cafe", "Đi chợ", "Siêu thị". (Tránh dùng "Ăn uống" chung chung).
2. Hóa đơn: "Hóa đơn Điện", "Hóa đơn Nước", "Internet", "Điện thoại", "iCloud/Google Drive", "Chung cư".
3. Di chuyển: "Xăng xe", "Gửi xe", "Grab/Taxi", "Bảo dưỡng xe".
4. Mua sắm: "Quần áo", "Mỹ phẩm", "Gia dụng", "Thiết bị điện tử".
5. Sức khỏe: "Thuốc men", "Khám chữa bệnh", "Thể thao/Gym".
6. Phát triển: "Sách vở", "Sự kiện/Hội thảo", "Khoá học".
7. Khác: "Hiếu hỉ", "Từ thiện", "Cho vay", "Trả nợ", "Làm đẹp".

Nếu không chắc chắn, hãy chọn danh mục phù hợp nhất.

Trả về JSON theo mẫu:
{
  "intent": "transaction" | "report" | "delete" | "chat",
  "type": "thu" hoặc "chi" (bắt buộc nếu intent là transaction/delete),
  "amount": số tiền (VNĐ, integer) (bắt buộc nếu intent là transaction/delete),
  "note": "mô tả ngắn",
  "category": "Tên danh mục chi tiết HOẶC từ khoá tìm kiếm báo cáo",
  "date": "YYYY-MM-DD" (Optional, nếu tìm thấy ngày cụ thể),
  "report_type": "day" | "month" | "year" | "category" | "top_category" | "all",
  "reaction": "một câu phản hồi tự nhiên, vui vẻ, thân mật, có emoji"
}
Câu của người dùng: "${text}"
Tên người dùng: "${userName}"
`;

    // API Key Rotation Logic
    const keys = GEMINI_KEY.split(",").map(k => k.trim());
    let responseCode = 0;
    let contentText = "";
    
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!key) continue;
      const keySnippet = "..." + key.slice(-4);
      Logger.log(`Using API Key ${keySnippet}`);
      
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
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

      try {
        const res = UrlFetchApp.fetch(url, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });

        responseCode = res.getResponseCode();
        contentText = res.getContentText();
        
        if (responseCode === 200) {
           break; // Success
        } else {
           // If error, notify user roughly what happened before switching
           const isLastKey = (i === keys.length - 1);
           const errorMsg = `⚠️ <b>API Warning:</b> Key <code>${keySnippet}</code> report code <b>${responseCode}</b>.`;
           
           if (!isLastKey) {
             sendMessage(chatId, `${errorMsg}\n🔄 Đang chuyển sang Key tiếp theo...`, "HTML");
           } else {
             sendMessage(chatId, `${errorMsg}\n❌ Đã hết Key dự phòng!`, "HTML");
           }
           
           Logger.log(`API Key exhausted/error (${responseCode}). Content: ${contentText}`);
           // Continue loop to try next key
        }
      } catch (fetchErr) {
         Logger.log(`Fetch error with key ...${key.slice(-4)}: ${fetchErr}`);
         sendMessage(chatId, `⚠️ <b>Network Error:</b> ${fetchErr.message}\n🔄 Đang thử lại...`, "HTML");
      }
    }

    Logger.log(`Final Gemini response code: ${responseCode}`);
    
    // ... (rest of parsing logic) ...

    if (responseCode !== 200) {
      return { error: `All API keys failed. Last error: ${responseCode}`, raw: contentText };
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

    // Aggressive JSON sanitization
    jsonString = jsonString.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    
    try {
      return JSON.parse(jsonString.trim());
    } catch (parseErr) {
       Logger.log("First JSON parse failed: " + parseErr + ". Raw: " + jsonString);
      return { error: "JSON Parse Error: " + parseErr.message, raw: raw };
    }
  } catch (e) {
    Logger.log("Gemini parse error: " + e);
    return { error: "Exception: " + e.toString(), raw: "Check logs" };
  }
}

const CATEGORY_GROUPS = {
  "ăn uống": ["ăn", "cafe", "nước", "nhậu", "siêu thị", "chợ", "bún", "phở", "cơm"],
  "di chuyển": ["xe", "grab", "taxi", "xăng", "đỗ", "gửi", "bảo dưỡng"],
  "nhà cửa": ["điện", "nước", "net", "nhà", "gas", "chung cư", "phí quản lý"],
  "mua sắm": ["mua", "quần áo", "mỹ phẩm", "giày", "túi"],
  "sức khỏe": ["thuốc", "khám", "gym", "spa", "bệnh"],
  "giải trí": ["phim", "game", "du lịch", "vé"],
  "thu nhập": ["lương", "thưởng", "lãi", "bán"]
};

// =====================================================
// TELEGRAM FILE DOWNLOADER
// =====================================================
function getTelegramFile(fileId) {
  try {
    const url = `${TG_API}/getFile?file_id=${fileId}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const json = JSON.parse(res.getContentText());
    if (!json.ok || !json.result) return null;
    
    const filePath = json.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    
    let blob = UrlFetchApp.fetch(downloadUrl).getBlob();
    
    // Explicitly set MIME type based on extension if generic
    const ext = filePath.split('.').pop().toLowerCase();
    if (ext === "jpg" || ext === "jpeg") blob.setName("image.jpg").setContentType("image/jpeg");
    else if (ext === "png") blob.setName("image.png").setContentType("image/png");
    else if (ext === "webp") blob.setName("image.webp").setContentType("image/webp");
    else blob.setContentType("image/jpeg"); // Fallback for Gemini

    return blob;
  } catch (e) {
    Logger.log("getTelegramFile error: " + e);
    return null;
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
    sh.appendRow(["Date", "User", "Type", "Amount", "Note", "Category"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function appendToSheet(data, user) {
  const sh = ensureSheet();
  // Columns: A=Date, B=User, C=Type, D=Amount, E=Note, F=Category
  let dateObj = new Date();
  if (data.date) {
    const parsed = new Date(data.date);
    // Check if valid date
    if (!isNaN(parsed.getTime())) {
      dateObj = parsed;
    }
  }
  sh.appendRow([dateObj, user, data.type, data.amount, data.note, data.category]);
  SpreadsheetApp.flush(); // Force write to ensure subsequent reads see this new row
}

function getLastTransaction() {
  const sh = ensureSheet();
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return null;
  const vals = sh.getRange(lastRow, 1, 1, 6).getValues()[0];
  return {
    date: vals[0], user: vals[1], type: vals[2], amount: vals[3], note: vals[4], category: vals[5]
  };
}

function deleteLastTransaction() {
  const sh = ensureSheet();
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return false;
  sh.deleteRow(lastRow);
  return true;
}

function deleteTransactionByCriteria(data) {
  // Try to find a transaction matching Amount AND Type in the last 20 rows
  const sh = ensureSheet();
  const lastRow = sh.getLastRow();
  const startRow = Math.max(2, lastRow - 20); // Scan last 20 items
  if (lastRow < 2) return false;

  const range = sh.getRange(startRow, 1, lastRow - startRow + 1, 6);
  const values = range.getValues();
  
  // Iterate backwards
  for (let i = values.length - 1; i >= 0; i--) {
     const row = values[i];
     const [date, user, type, amt, note, cat] = row;
     
     // Fuzzy match logic
     if (type === data.type && Number(amt) === Number(data.amount)) {
        // Found it! Delete relative to sheet
        const sheetRowIndex = startRow + i; 
        sh.deleteRow(sheetRowIndex);
        return true;
     }
  }
  return false;
}

// =====================================================
// REPORTING FUNCTIONS
// =====================================================
function getFinanceReport(mode = "all") {
  // ... (unchanged) ...
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions");
  if (sh.getLastRow() <= 1) return "⚠️ Chưa có dữ liệu nào.";
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
    if (mode === "year" && (date.getFullYear() !== y)) continue;
    
    if (type === "thu") totalThu += amt;
    if (type === "chi") totalChi += amt;
  }

  const balance = totalThu - totalChi;
  const emoji = balance >= 0 ? "🟢" : "🔴";
  let title = "📊 <b>Báo cáo tổng hợp</b>";
  if (mode === "day") title = "📅 <b>Báo cáo hôm nay</b>";
  if (mode === "month") title = "🗓️ <b>Báo cáo tháng này</b>";
  if (mode === "year") title = "🎆 <b>Báo cáo năm nay</b>";

  return `${title}\n\n💰 <b>Tổng thu:</b> ${totalThu.toLocaleString()}đ\n💸 <b>Tổng chi:</b> ${totalChi.toLocaleString()}đ\n${emoji} <b>Cân đối:</b> ${balance.toLocaleString()}đ`;
}

function getCategoryReport(filterKeyword = null) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions");
  if (!sh || sh.getLastRow() <= 1) return "📭 Chưa có dữ liệu nào.";
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const totals = {};
  let totalFiltered = 0;

  const normalizedKeyword = filterKeyword ? filterKeyword.toLowerCase() : null;
  
  // Check if keyword matches a group
  let targetKeywords = [normalizedKeyword];
  if (normalizedKeyword && CATEGORY_GROUPS[normalizedKeyword]) {
    targetKeywords = CATEGORY_GROUPS[normalizedKeyword];
  }

  data.forEach(row => {
    const [ , , type, amt, , category ] = row;
    if (type === "chi") {
       const amount = Number(amt || 0);
       const catLower = (category || "").toLowerCase();
       
       let isMatch = false;
       if (!normalizedKeyword) {
         isMatch = true;
       } else {
         // Check against all target keywords (or single keyword)
         isMatch = targetKeywords.some(k => catLower.includes(k));
       }

       if (isMatch) {
          // If grouping is active, map specific category to group name
          let displayCat = category;
          if (filterKeyword) displayCat = category; // Detailed view inside report
          
          totals[displayCat] = (totals[displayCat] || 0) + amount;
          totalFiltered += amount;
       }
    }
  });

  const entries = Object.entries(totals);
  if (entries.length === 0) return `📭 Không tìm thấy khoản chi nào cho '${filterKeyword || "tất cả"}'.`;
  entries.sort((a, b) => b[1] - a[1]);

  let result = filterKeyword 
    ? `🏷️ <b>Báo cáo chi tiêu: ${filterKeyword}</b>\n\n💰 <b>Tổng cộng Group: ${totalFiltered.toLocaleString()}đ</b>\n\n`
    : "🏷️ <b>Báo cáo theo danh mục chi tiêu</b>\n\n";
    
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
// STATS HELPERS
// =====================================================
function calculateMonthlyStats(targetCategory) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Transactions");
  if (!sh || sh.getLastRow() <= 1) return { totalMonth: 0, totalCategory: 0 };
  
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const today = new Date();
  const m = today.getMonth();
  const y = today.getFullYear();
  
  let totalMonth = 0;
  let totalDetailed = 0;
  let totalGroup = 0;
  let detectedGroupName = null;
  
  const targetCatLower = (targetCategory || "").toLowerCase();
  
  // Resolve group keywords
  let groupKeywords = [];
  
  // Auto-detect group
  for (const [groupName, keywords] of Object.entries(CATEGORY_GROUPS)) {
     if (keywords.some(k => targetCatLower.includes(k))) {
       groupKeywords = keywords;
       detectedGroupName = groupName.charAt(0).toUpperCase() + groupName.slice(1); // Capitalize
       break;
     }
  }

  data.forEach(row => {
    const [ts, , type, amt, , cat] = row;
    if (!type || type.toLowerCase() !== "chi") return;
    
    const date = new Date(ts);
    if (date.getMonth() === m && date.getFullYear() === y) {
      const amount = Number(amt || 0);
      totalMonth += amount;
      
      const rowCatLower = (cat || "").toLowerCase();
      
      // 1. Detailed Match (Exact or contain strict)
      if (rowCatLower.includes(targetCatLower)) {
        totalDetailed += amount;
      }
      
      // 2. Group Match
      if (groupKeywords.length > 0 && groupKeywords.some(k => rowCatLower.includes(k))) {
        totalGroup += amount;
      }
    }
  });

  return { totalMonth, totalDetailed, totalGroup, detectedGroupName };
}

// =====================================================
// TELEGRAM MESSAGE SENDER
// =====================================================
function sendMessage(chatId, text, mode = "HTML", buttons = null) {
  const payload = { chat_id: chatId, text, parse_mode: mode };
  if (buttons) payload.reply_markup = { inline_keyboard: buttons };
  
  try {
    const res = UrlFetchApp.fetch(`${TG_API}/sendMessage`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    // Check for HTTP errors (since we muted exceptions)
    if (res.getResponseCode() !== 200) {
      throw new Error(`Telegram API Error (${res.getResponseCode()}): ${res.getContentText()}`);
    }
  } catch (e) {
    Logger.log(`Failed to send message in ${mode} mode: ${e}`);
    
    // RETRY FALLBACK: If HTML mode failed, try plain text
    if (mode === "HTML") {
      Logger.log("Retrying with plain text...");
      try {
        delete payload.parse_mode; // Clear parse mode to send as Plain Text
        const retryRes = UrlFetchApp.fetch(`${TG_API}/sendMessage`, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });
        if (retryRes.getResponseCode() !== 200) {
           Logger.log(`Retry with plain text also failed: ${retryRes.getContentText()}`);
           // Last resort: Notify user that message sending failed completely
           UrlFetchApp.fetch(`${TG_API}/sendMessage`, {
             method: "post",
             contentType: "application/json",
             payload: JSON.stringify({ chat_id: chatId, text: "🆘 Lỗi hiển thị: Telegram từ chối tin nhắn này (400 Bad Request)." }),
             muteHttpExceptions: true
           });
        }
      } catch (retryErr) {
        Logger.log(`Retry also failed: ${retryErr}`);
      }
    }
  }
}

function setMessageReaction(chatId, messageId, emoji) {
  // Telegram API: setMessageReaction
  // Reaction must be one of the supported emojis
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji: emoji }]
  };
  
  try {
    UrlFetchApp.fetch(`${TG_API}/setMessageReaction`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log("Reaction error: " + e);
  }
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
