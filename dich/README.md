# Bản dịch tiếng Việt — Mewomo, Uzor & Gibali (2024)

Tệp `mewomo-2024-bai-toan-tach-dang-thuc-vi.tex` là bản dịch tiếng Việt đầy đủ của bài báo:

> O. T. Mewomo, V. A. Uzor, A. Gibali,
> **"A strongly convergent algorithm for solving split equality problems beyond monotonicity"**,
> *Computational and Applied Mathematics* (2024) **43**:326.
> https://doi.org/10.1007/s40314-024-02829-w

Bài báo gốc phát hành theo giấy phép **Creative Commons Attribution 4.0 (CC BY 4.0)**, cho phép
dịch/phóng tác kèm ghi nguồn. Bản dịch giữ **nguyên vẹn toàn bộ nội dung toán học** (định nghĩa,
bổ đề, định lý, chứng minh, thuật toán, ví dụ số, bảng số liệu) và chỉ dịch phần văn xuôi sang
tiếng Việt. Tên tác giả, tiêu đề tạp chí và danh mục tài liệu tham khảo được giữ nguyên gốc.

## Biên dịch

Tài liệu dùng bảng mã tiếng Việt T5 (gói `vntex`, có sẵn trong TeX Live/MiKTeX).

**pdfLaTeX** (mặc định):

```bash
pdflatex mewomo-2024-bai-toan-tach-dang-thuc-vi.tex
pdflatex mewomo-2024-bai-toan-tach-dang-thuc-vi.tex   # chạy 2 lần để cập nhật tham chiếu chéo
```

**XeLaTeX / LuaLaTeX** (nếu muốn dùng phông hệ thống): mở tệp `.tex`, thay ba dòng
`inputenc/fontenc/babel` ở đầu preamble bằng khối `fontspec + polyglossia` đã được ghi chú sẵn
ngay bên dưới chúng, rồi chạy `xelatex` hai lần.

## Ghi chú

- Các Hình 1–8 trong bản gốc là đồ thị sai số theo bước lặp (kết quả mô phỏng MATLAB) nên không
  được tái tạo; số liệu định lượng tương ứng nằm trong **Bảng 2** và **Bảng 3**.
- Cách đánh số định lý/bổ đề/phương trình theo mục được giữ khớp với bản gốc (ví dụ Bổ đề 4.3,
  phương trình (4.10), v.v.).
- Một lỗi sắp chữ nhỏ trong bản gốc (một cặp dấu chuẩn thừa ở khai triển của $\|x_{n+1}-x^*\|^2$
  trong chứng minh tính bị chặn) đã được chỉnh về dạng đúng chuẩn.
