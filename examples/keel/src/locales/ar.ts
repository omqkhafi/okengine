import { defineMessages, defineLocale } from "okengine";

export const ar = defineMessages({
  errors: {
    notFound: "غير موجود",
    unauthorized: "غير مصرح",
    cycleClosed: "هذه الدورة مغلقة.",
    duplicate: "موجود مسبقاً.",
    unavailable: "خدمة الذكاء الاصطناعي غير متاحة. حاول لاحقاً.",
  },
  issues: {
    created: "تم إنشاء المسألة {identifier}.",
    assigned: "أُسندت المسألة {identifier} إلى {email}.",
    archived: "أُرشفت المسألة.",
  },
});

defineLocale("ar", ar);
