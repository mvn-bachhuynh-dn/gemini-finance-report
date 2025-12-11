Tính năng đã hoạt động tốt:
- Multiple AI tokens
- Ví dụ: Chat "hello" => Trả về tin nhắn chào từ AI => OK
- Ví dụ: Ăn trưa 333k => Ghi được vào Sheet và trả lời lại cho user thành công => OK   
- Ví dụ: Xóa Ăn trưa 333k => Xóa được ở Sheet và trả lời lại cho user thành công => OK
- Ví dụ:Gởi ảnh bill => Gởi được cho AI, AI phân tích và trả lời lại được, bot gởi tin thành công cho user => OK
- Ví dụ:Khi tôi nói: "Tôi đã chi tiền ăn sáng cho tháng này bao nhiêu" thì gởi tổng đúng category Ăn Sáng 

Còn tồn tại:
- Chưa hiểu đúng ngữ cảnh của người dùng: Khi tôi nói: "Tôi đã chi tiền ăn uống trong tháng này bao nhiêu: thì tổng toàn bộ category liên quan tới Ăn uống ("Ăn sáng", "Ăn trưa", "Ăn tối", "Ăn vặt/Cafe", "Đi chợ/Siêu thị"). Như vậy, script phải tìm đúng các category liên quan tới "Ăn uống" để tính sum cho đúng. Gợi ý: Có thể phải lưu lại các category liên quan tới "Ăn uống" trong một list để khi người dùng nói "Ăn uống" thì script sẽ tìm đúng các category liên quan tới "Ăn uống" để tính sum cho đúng.
- Chưa có thông tin tổng số tiền theo category/ tổng số tiền chi tiêu trong tháng mỗi khi thêm 1 mục chi tiêu mới.
