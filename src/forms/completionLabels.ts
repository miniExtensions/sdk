import type { RuntimeLanguage } from '../runtime/types.js';

export type FormCompletionLabels = {
    defaultSuccess: string;
    redirectingToNewForm: string;
    redirecting: string;
    closing: string;
    canClose: string;
    submitAnother: string;
    copySubmitted: string;
};

/** Native completion translations; custom labels are resolved by the projection. */
export const formCompletionLabels: Record<
    RuntimeLanguage,
    FormCompletionLabels
> = {
    en: {
        defaultSuccess: 'Form submitted successfully',
        redirectingToNewForm: 'Redirecting you to new form...',
        redirecting: 'Redirecting...',
        closing: 'Closing the form...',
        canClose: 'You can close this page',
        submitAnother: 'Submit another form',
        copySubmitted: 'Copy submission',
    },
    es: {
        defaultSuccess: 'Formulario enviado con éxito',
        redirectingToNewForm: 'Redirigiéndote a un nuevo formulario...',
        redirecting: 'Redirigiendo...',
        closing: 'Cerrando el formulario...',
        canClose: 'Puede cerrar esta página',
        submitAnother: 'Enviar otro formulario',
        copySubmitted: 'Copiar envío',
    },
    fr: {
        defaultSuccess: 'Formulaire soumis avec succès',
        redirectingToNewForm: 'Redirection vers un nouveau formulaire...',
        redirecting: 'Redirection...',
        closing: 'Fermeture du formulaire...',
        canClose: 'Vous pouvez fermer cette page',
        submitAnother: 'Soumettre un autre formulaire',
        copySubmitted: 'Copier la soumission',
    },
    vi: {
        defaultSuccess: 'Đã gửi biểu mẫu thành công',
        redirectingToNewForm: 'Đang chuyển hướng bạn đến biểu mẫu mới...',
        redirecting: 'Đang chuyển hướng...',
        closing: 'Đang đóng biểu mẫu...',
        canClose: 'Bạn có thể đóng trang này',
        submitAnother: 'Gửi mẫu khác',
        copySubmitted: 'Sao chép nội dung nộp',
    },
    nl: {
        defaultSuccess: 'Formulier succesvol verzonden',
        redirectingToNewForm:
            'U wordt doorgestuurd naar een nieuw formulier...',
        redirecting: 'Doorsturen...',
        closing: 'Formulier sluiten...',
        canClose: 'U kunt deze pagina sluiten',
        submitAnother: 'Nog een formulier indienen',
        copySubmitted: 'Inzending kopiëren',
    },
    de: {
        defaultSuccess: 'Formular erfolgreich übermittelt',
        redirectingToNewForm: 'Weiterleitung zu einem neuen Formular...',
        redirecting: 'Weiterleiten...',
        closing: 'Schließen des Formulars...',
        canClose: 'Sie können diese Seite schließen',
        submitAnother: 'Ein weiteres Formular einreichen',
        copySubmitted: 'Einreichung kopieren',
    },
    ja: {
        defaultSuccess: 'フォームが正常に送信されました',
        redirectingToNewForm: '新しいフォームにリダイレクトしています...',
        redirecting: 'リダイレクトしています...',
        closing: 'フォームを閉じています...',
        canClose: 'このページを閉じることができます',
        submitAnother: '別のフォームを送信する',
        copySubmitted: '提出内容をコピーする',
    },
    ko: {
        defaultSuccess: '양식이 성공적으로 제출되었습니다',
        redirectingToNewForm: '새 양식으로 리디렉션 중...',
        redirecting: '리디렉션 중...',
        closing: '양식 닫기...',
        canClose: '이 페이지를 닫을 수 있습니다',
        submitAnother: '다른 양식 제출하기',
        copySubmitted: '제출 내용 복사하기',
    },
    pt: {
        defaultSuccess: 'Formulário enviado com sucesso',
        redirectingToNewForm: 'Redirecionando você para um novo formulário...',
        redirecting: 'Redirecionando...',
        closing: 'Fechando o formulário...',
        canClose: 'Você pode fechar esta página',
        submitAnother: 'Enviar outro formulário',
        copySubmitted: 'Copiar envio',
    },
    cs: {
        defaultSuccess: 'Formulář byl úspěšně odeslán',
        redirectingToNewForm: 'Přesměrování na nový formulář...',
        redirecting: 'Přesměrování...',
        closing: 'Zavírání formuláře...',
        canClose: 'Tuto stránku můžete zavřít',
        submitAnother: 'Odeslat další formulář',
        copySubmitted: 'Kopírovat odeslání',
    },
    he: {
        defaultSuccess: 'טופס נשלח בהצלחה',
        redirectingToNewForm: 'מעביר אותך לטופס חדש...',
        redirecting: 'מעביר...',
        closing: 'סוגר את הטופס...',
        canClose: 'אתה יכול לסגור דף זה',
        submitAnother: 'שלח טופס אחר',
        copySubmitted: 'העתק את ההגשה',
    },
    it: {
        defaultSuccess: 'Modulo inviato con successo',
        redirectingToNewForm: 'Reindirizzamento al nuovo modulo...',
        redirecting: 'Reindirizzamento...',
        closing: 'Chiusura del modulo...',
        canClose: 'Puoi chiudere questa pagina',
        submitAnother: 'Invia un altro modulo',
        copySubmitted: 'Copia la presentazione',
    },
    ka: {
        defaultSuccess: 'ფორმა წარმოებულია წარმატებით',
        redirectingToNewForm: 'გადართვა ახალ ფორმაზე...',
        redirecting: 'გადართვა...',
        closing: 'ფორმის დახურვა...',
        canClose: 'შეგიძლიათ გახსნა',
        submitAnother: 'სხვა ფორმის გაგზავნა',
        copySubmitted: 'გაგზავნის კოპირება',
    },
    'zh-Hans': {
        defaultSuccess: '表单已成功提交',
        redirectingToNewForm: '正在将您重定向到新表单...',
        redirecting: '重定向...',
        closing: '关闭表单...',
        canClose: '您可以关闭此页面',
        submitAnother: '提交另一个表单',
        copySubmitted: '复制提交',
    },
    ca: {
        defaultSuccess: 'Formulari enviat correctament',
        redirectingToNewForm: 'Redirigint-vos a un nou formulari...',
        redirecting: 'Redirigint...',
        closing: 'Tancant el formulari...',
        canClose: 'Podeu tancar aquesta pàgina',
        submitAnother: 'Envia un altre formulari',
        copySubmitted: 'Copia la presentació',
    },
};
