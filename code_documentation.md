# 📘 Gemini Finance Bot Documentation

## 1. Tổng quan (Overview)
**Gemini Finance Bot** là một trợ lý tài chính cá nhân trên Telegram, được xây dựng bằng **Google Apps Script**. Bot sử dụng **Google Gemini AI** để hiểu ngôn ngữ tự nhiên, giúp người dùng ghi lại thu chi một cách dễ dàng và lưu trữ dữ liệu vào **Google Sheets**.

### Tính năng chính:
- 🗣️ **Nhập liệu tự nhiên**: "Ăn sáng 30k", "Nhận lương 10tr" (AI tự phân loại).
- 📊 **Báo cáo đa dạng**: Theo ngày, tháng, danh mục, top chi tiêu.
- ↩️ **Hoàn tác (Undo)**: Xoá giao dịch nhập sai gần nhất.
- ⏰ **Tự động hoá**: Nhắc nhở nhập liệu và gửi báo cáo hàng ngày.

---

## 2. Cấu trúc Code (Code Structure)

File [gemini-bot.vi.gs](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs) được chia thành các phần chính sau:

### A. Cấu hình (Configuration)
Nơi khai báo các biến môi trường và hằng số quan trọng.
- `BOT_TOKEN`: Token của Telegram Bot.
- `GEMINI_KEY`: API Key của Google Gemini.
- `SHEET_ID`: ID của Google Sheet lưu dữ liệu.
- `ADMIN_CHAT_ID`: ID người dùng admin (để gửi thông báo tự động).

### B. Webhook Entry Point ([doPost](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#12-114))
Hàm [doPost(e)](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#12-114) là cửa ngõ nhận mọi tin nhắn từ Telegram.
- **Luồng xử lý**:
  1. Nhận JSON từ Telegram.
  2. Kiểm tra tin nhắn (bỏ qua tin từ bot khác).
  3. Phân tích lệnh (Command) hoặc văn bản thường.
  4. Nếu là lệnh (`/start`, `/report`, `/undo`...): Gọi hàm xử lý tương ứng.
  5. Nếu là văn bản thường: Gửi qua **Gemini AI** để phân tích -> Lưu vào Sheet -> Phản hồi.

### C. Xử lý AI ([parseAndReactWithGemini](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#115-151))
Hàm này gửi văn bản người dùng đến API Gemini.
- **Prompt**: Yêu cầu AI đóng vai trợ lý tài chính, trích xuất: `type` (thu/chi), `amount`, `category`, `note`, và `reaction` (câu trả lời vui vẻ).
- **Output**: Trả về Object JSON chứa thông tin giao dịch.

### D. Thao tác Google Sheets
- [ensureSheet()](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#152-169): Đảm bảo sheet "Transactions" tồn tại và có đủ cột.
- [appendToSheet()](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#170-182): Ghi dòng giao dịch mới vào cuối sheet.
- [getLastTransaction()](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#183-206) & [deleteLastTransaction()](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#207-223): Hỗ trợ tính năng Undo.

### E. Báo cáo (Reporting)
Các hàm tính toán số liệu từ Sheet:
- [getFinanceReport(mode)](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#224-253): Tính tổng thu/chi/cân đối (theo ngày, tháng hoặc toàn bộ).
- [getCategoryReport()](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#254-274): Gom nhóm chi tiêu theo danh mục.
- [getTopCategoryReport()](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#275-303): Tìm danh mục tiêu tốn nhiều tiền nhất trong tháng.

### F. Gửi tin nhắn ([sendMessage](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#304-317))
Hàm tiện ích để gọi Telegram API ([sendMessage](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#304-317)), hỗ trợ định dạng HTML/Markdown và Inline Buttons.

### G. Tự động hoá (Automation Jobs)
Các hàm này cần được cài đặt Trigger (Time-driven) trong Apps Script:
- [dailyReminderJob()](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#318-326): Nhắc nhở lúc 20:00.
- [dailyReportJob()](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#327-331): Báo cáo lúc 21:00.

---

## 3. Luồng dữ liệu (Data Flow)

1. **User** gửi tin nhắn: *"Mua trà sữa 50k"*
2. **Telegram** gọi Webhook ([doPost](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#12-114)).
3. **Script** xác định đây không phải lệnh đặc biệt.
4. **Gemini AI** phân tích: `{ type: "chi", amount: 50000, category: "Ăn uống", ... }`
5. **Script** lưu vào **Google Sheet**.
6. **Script** gửi tin nhắn phản hồi lại User: *"✅ Đã ghi: chi 50.000đ..."*

---

## 4. Hướng dẫn mở rộng (Extensibility)

Để thêm tính năng mới, bạn có thể tham khảo các gợi ý sau:

### Thêm lệnh mới (Ví dụ: `/budget` để xem hạn mức)
1. Trong [doPost](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#12-114), thêm điều kiện `if (command === "/budget")`.
2. Viết hàm xử lý logic (ví dụ: đọc hạn mức từ một sheet khác).
3. Gọi [sendMessage](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#304-317) để trả về kết quả.

### Cải thiện AI
- Sửa biến `prompt` trong hàm [parseAndReactWithGemini](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#115-151) để AI thông minh hơn hoặc trích xuất thêm thông tin (ví dụ: phương thức thanh toán).

### Thêm biểu đồ
- Sử dụng `QuickChart.io` để tạo URL hình ảnh biểu đồ từ dữ liệu, sau đó gửi ảnh qua Telegram (`sendPhoto`).

---

## 5. Thiết lập Trigger (Quan trọng)
Để bot tự động nhắc nhở và báo cáo, bạn cần vào menu **Triggers** (hình đồng hồ) trong Apps Script:
- Tạo trigger cho [dailyReminderJob](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#318-326): Time-driven -> Day timer -> 8pm to 9pm.
- Tạo trigger cho [dailyReportJob](file:///Users/bach.huynh/Documents/Documents%20-%20BachHuynh/Project/mvn-bachhuynh-dn/gemini-finance-bot/src/gemini-bot.vi.gs#327-331): Time-driven -> Day timer -> 9pm to 10pm.
