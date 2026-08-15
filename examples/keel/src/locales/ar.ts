import { defineMessages, defineLocale } from "okengine";

export const ar = defineMessages({
  errors: {
    notFound: "غير موجود",
    unauthorized: "غير مصرح",
    duplicate: "موجود مسبقاً.",
    unavailable: "خدمة الذكاء الاصطناعي غير متاحة. حاول لاحقاً.",
    forbidden: "دورك لا يسمح بذلك.",
  },
  tasks: {
    created: "تم إنشاء المهمة {identifier}.",
    assigned: "أُسندت المهمة {identifier} إلى {email}.",
    completed: "اكتملت المهمة.",
    archived: "أُرشفت المهمة.",
  },
});

defineLocale("ar", ar);
