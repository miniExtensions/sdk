import type { RuntimeLanguage } from '../runtime/types.js';

export type ButtonFieldMessages = {
    noValue: string;
    success: string;
    error: string;
};

// Button-only localized defaults; configured feedback takes precedence, including ''.
export const buttonMessages: Record<RuntimeLanguage, ButtonFieldMessages> = {
    en: {
        noValue: 'No Button',
        success: 'Webhook triggered successfully',
        error: 'Error triggering webhook',
    },
    es: {
        noValue: 'Sin Botón',
        success: 'Webhook enviado con éxito',
        error: 'Error al activar el webhook',
    },
    fr: {
        noValue: 'Pas de Bouton',
        success: 'Webhook déclenché avec succès',
        error: 'Erreur lors du déclenchement du webhook',
    },
    vi: {
        noValue: 'Không có Nút',
        success: 'Webhook kích hoạt thành công',
        error: 'Lỗi kích hoạt webhook',
    },
    nl: {
        noValue: 'Geen Knop',
        success: 'Webhook succesvol geactiveerd',
        error: 'Fout bij het activeren van webhook',
    },
    de: {
        noValue: 'Keine Taste',
        success: 'Webhook erfolgreich ausgelöst',
        error: 'Fehler beim Auslösen des Webhooks',
    },
    ja: {
        noValue: 'いいえボタン',
        success: 'Webhookが正常にトリガーされました',
        error: 'Webhookのトリガー中にエラーが発生しました',
    },
    ko: {
        noValue: '아니요 버튼',
        success: 'Webhook이 성공적으로 트리거되었습니다',
        error: 'Webhook을 트리거하는 중에 오류가 발생했습니다',
    },
    pt: {
        noValue: 'Sem Botão',
        success: 'Webhook acionado com sucesso',
        error: 'Erro ao acionar webhook',
    },
    cs: {
        noValue: 'Žádné tlačítko',
        success: 'Webhook úspěšně spuštěn',
        error: 'Chyba při spouštění webhooku',
    },
    he: {
        noValue: 'אין לחצן',
        success: 'Webhook הופעל בהצלחה',
        error: 'שגיאה בהפעלת webhook',
    },
    it: {
        noValue: 'Nessun Pulsante',
        success: 'Webhook attivato con successo',
        error: "Errore nell'attivazione del webhook",
    },
    ka: {
        noValue: 'არცერთი ღილაკი',
        success: 'Webhook წარმატებით გამოიყენებულია',
        error: 'Webhook-ის გამოყენების შეცდომა',
    },
    'zh-Hans': {
        noValue: '没有按钮',
        success: 'Webhook成功触发',
        error: '触发webhook时出错',
    },
    ca: {
        noValue: 'Sense Botó',
        success: 'Webhook enviat amb èxit',
        error: 'Error en enviar el webhook',
    },
};
