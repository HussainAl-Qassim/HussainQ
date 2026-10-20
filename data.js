/* ============================================================
   بيانات كتب المرحلة المتوسطة — المنهج السعودي 1448
   ------------------------------------------------------------
   تسمية الملفات داخل مجلد كتب/gradeX :
   key-sem.pdf   (key = مفتاح الكتاب، sem = رقم الفصل 1/2/3)
   مثال: lughati-1.pdf  = لغتي الفصل الأول
   ============================================================ */

const BOOKS_DATA = {
  1: {
    gradeName: "الصف الأول المتوسط",
    books: [
      { key: "lughati",   name: "لغتي الخالدة",   desc: "اللغة العربية",          icon: "✍️", sems: 1 },
      { key: "math",      name: "الرياضيات",       desc: "رياضيات أول متوسط",      icon: "🔢", sems: 1 },
      { key: "science",   name: "العلوم",          desc: "علوم أول متوسط",          icon: "🔬", sems: 1 },
      { key: "islamic",   name: "الدراسات الإسلامية", desc: "توحيد، فقه، حديث، تفسير", icon: "🕌", sems: 1 },
      { key: "social",    name: "الدراسات الاجتماعية", desc: "تاريخ وجغرافيا",        icon: "🌍", sems: 1 },
      { key: "english",   name: "اللغة الإنجليزية", desc: "Super Goal 1",           icon: "🇬🇧", sems: 1 },
      { key: "digital",   name: "المهارات الرقمية", desc: "الحاسب وتقنية المعلومات", icon: "💻", sems: 1 },
      { key: "lifeskills", name: "المهارات الحياتية والأسرية", desc: "مهارات عملية للحياة", icon: "🏠", sems: 1 },
      { key: "pe",        name: "التربية البدنية والدفاع عن النفس", desc: "اللياقة البدنية", icon: "⚽", sems: 1 }
    ]
  },

  2: {
    gradeName: "الصف الثاني المتوسط",
    books: [
      { key: "lughati",   name: "لغتي الخالدة",   desc: "اللغة العربية",          icon: "✍️", sems: 1 },
      { key: "math",      name: "الرياضيات",       desc: "رياضيات ثاني متوسط",      icon: "🔢", sems: 1 },
      { key: "science",   name: "العلوم",          desc: "علوم ثاني متوسط",          icon: "🔬", sems: 1 },
      { key: "islamic",   name: "الدراسات الإسلامية", desc: "توحيد، فقه، حديث، تفسير", icon: "🕌", sems: 1 },
      { key: "social",    name: "الدراسات الاجتماعية", desc: "تاريخ وجغرافيا",        icon: "🌍", sems: 1 },
      { key: "english",   name: "اللغة الإنجليزية", desc: "Super Goal 2",           icon: "🇬🇧", sems: 1 },
      { key: "digital",   name: "المهارات الرقمية", desc: "الحاسب وتقنية المعلومات", icon: "💻", sems: 1 },
      { key: "lifeskills", name: "المهارات الحياتية والأسرية", desc: "مهارات عملية للحياة", icon: "🏠", sems: 1 },
      { key: "art",       name: "التربية الفنية",  desc: "فنون تشكيلية",            icon: "🎨", sems: 1 },
      { key: "pe",        name: "التربية البدنية والدفاع عن النفس", desc: "اللياقة البدنية", icon: "⚽", sems: 1 }
    ]
  },

  3: {
    gradeName: "الصف الثالث المتوسط",
    books: [
      { key: "lughati",   name: "لغتي الخالدة",   desc: "اللغة العربية",          icon: "✍️", sems: 1 },
      { key: "math",      name: "الرياضيات",       desc: "رياضيات ثالث متوسط",      icon: "🔢", sems: 1 },
      { key: "science",   name: "العلوم",          desc: "علوم ثالث متوسط",          icon: "🔬", sems: 1 },
      { key: "islamic",   name: "الدراسات الإسلامية", desc: "توحيد، فقه، حديث، تفسير", icon: "🕌", sems: 1 },
      { key: "social",    name: "الدراسات الاجتماعية", desc: "تاريخ وجغرافيا",        icon: "🌍", sems: 1 },
      { key: "english",   name: "اللغة الإنجليزية", desc: "Super Goal 3",           icon: "🇬🇧", sems: 1 },
      { key: "digital",   name: "المهارات الرقمية", desc: "الحاسب وتقنية المعلومات", icon: "💻", sems: 1 },
      { key: "lifeskills", name: "المهارات الحياتية والأسرية", desc: "مهارات عملية للحياة", icon: "🏠", sems: 1 },
      { key: "art",       name: "التربية الفنية",  desc: "فنون تشكيلية",            icon: "🎨", sems: 1 },
      { key: "critical",  name: "التفكير الناقد",  desc: "مهارات التفكير وحل المشكلات", icon: "🧠", sems: 1 },
      { key: "pe",        name: "التربية البدنية والدفاع عن النفس", desc: "اللياقة البدنية", icon: "⚽", sems: 1 }
    ]
  }
};