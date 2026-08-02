import { defineLocale } from "okengine";
import type { MessagesFor } from "okengine";
import type { en } from "./en";

const ar = {
  errors: {
    notFound: "غير موجود",
    unauthorized: "غير مصرح",
  },
  notes: {
    created: "تم إنشاء الملاحظة «{title}».",
    archived: "تم أرشفة الملاحظة.",
    empty: "لا توجد ملاحظات نشطة بعد.",
    count: "{count, plural, zero {لا ملاحظات} one {ملاحظة واحدة} two {ملاحظتان} few {# ملاحظات} many {# ملاحظة} other {# ملاحظة}}",
  },
} satisfies MessagesFor<typeof en>;

defineLocale("ar", ar);
