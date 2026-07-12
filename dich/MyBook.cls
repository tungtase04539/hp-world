%=======================================================================
%  MyBook.cls  --- Lớp tài liệu tiếng Việt kiểu sách / đề cương
%  (do trợ lý tạo để 4 tài liệu dùng chung một khuôn định dạng).
%
%  LƯU Ý: Đây KHÔNG phải file MyBook.cls gốc của bạn (mình chưa xem được
%  nội dung file đó). Lớp này gói sẵn: lớp cơ sở `book`, hỗ trợ tiếng Việt
%  (T5 + babel), các gói toán, trang bìa/mục lục, môi trường `abstract`,
%  và một số thiết lập trình bày. Nếu muốn khớp đúng template trường bạn,
%  hãy dùng file MyBook.cls gốc của bạn (các .tex vẫn giữ nguyên phần nội
%  dung; có thể cần bỏ bớt vài dòng \newtheorem nếu lớp gốc đã định nghĩa).
%
%  Biên dịch: pdfLaTeX (cần gói vntex cho bảng mã T5). Chạy pdflatex 2 lượt.
%=======================================================================
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{MyBook}[2026/03/22 v1.0 Lop tai lieu tieng Viet kieu sach/de cuong]

% Chuyển mọi tùy chọn cho lớp book, mặc định 11pt/a4paper/oneside
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{book}}
\ProcessOptions\relax
\LoadClass[11pt,a4paper,oneside]{book}

% ---- Hỗ trợ tiếng Việt (TỰ NHẬN DIỆN trình biên dịch) ----
%  * XeLaTeX/LuaLaTeX (KHUYẾN NGHỊ): dùng fontspec + polyglossia, phông
%    Latin Modern có sẵn glyph tiếng Việt -> KHÔNG cần cài gói vntex.
%  * pdfLaTeX: dùng T5 + babel (cần gói vntex).
\RequirePackage{iftex}
\ifPDFTeX
  \RequirePackage[utf8]{inputenc}
  \RequirePackage[T5]{fontenc}
  \RequirePackage[vietnamese]{babel}
\else
  \RequirePackage{fontspec}
  \RequirePackage{polyglossia}
  \setmainlanguage{vietnamese}
\fi

% ---- Gói toán & trình bày ----
\RequirePackage{amsmath,amssymb,amsthm,amsfonts,mathtools}
\RequirePackage{bm}
\RequirePackage{enumitem}
\RequirePackage{graphicx}
\RequirePackage{booktabs}
\RequirePackage{array}
\RequirePackage{rotating}
\RequirePackage[margin=2.5cm]{geometry}
\RequirePackage[hidelinks]{hyperref}
\RequirePackage{xurl}

% ---- Thiết lập chung ----
\allowdisplaybreaks
\setlength{\emergencystretch}{3em}
\renewcommand{\proofname}{Chứng minh}

% ---- Môi trường "abstract" (lớp book không có sẵn) ----
\newenvironment{abstract}
  {\begin{quotation}\small\noindent\textbf{Tóm tắt.\ }}
  {\end{quotation}\normalsize}

\endinput
