import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ModalUi from '../../primitives/ModalUi';
import {
  CA_PROVIDERS,
  callCaInitiate,
  callCaStatus,
  callCaCancel,
  callCaComplete,
  pollMs
} from '../../constant/caUtils';

// QR + Deeplink modal for external CA signing (Phase 1: CEO).
// Props: { isOpen, onClose, Parse, documentId, signerName, signerTitle, page, rect, onSigned }
function CaSignModal(props) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState('vnpt');
  const [state, setState] = useState('idle'); // idle|creating|waiting|signed|failed|expired|cancelled
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const countdown = useRef(null);

  const clearTimers = () => {
    if (timer.current) clearInterval(timer.current);
    if (countdown.current) clearInterval(countdown.current);
    timer.current = null;
    countdown.current = null;
  };

  useEffect(() => clearTimers, []);

  const startCountdown = (expiresAt) => {
    if (!expiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setState((s) => (s === 'waiting' ? 'expired' : s));
    };
    tick();
    countdown.current = setInterval(tick, 1000);
  };

  const startPolling = (tranId) => {
    timer.current = setInterval(async () => {
      try {
        const res = await callCaStatus(props.Parse, tranId);
        if (['signed', 'failed', 'expired', 'cancelled'].includes(res?.status)) {
          clearTimers();
          setData(res);
          setState(res.status);
          if (res.status === 'signed') {
            try {
              const done = await callCaComplete(props.Parse, {
                tranId,
                signerName: props.signerName,
                signerTitle: props.signerTitle || 'CEO'
              });
              setData(done);
              props?.onSigned && props.onSigned(done);
            } catch (e) {
              setError(e?.message || t('ca-complete-failed'));
              setState('failed');
            }
          }
        }
      } catch (e) {
        setError(e?.message || t('ca-status-failed'));
      }
    }, pollMs());
  };

  const handleStart = async () => {
    setError('');
    setState('creating');
    clearTimers();
    try {
      const res = await callCaInitiate(props.Parse, {
        documentId: props.documentId,
        provider,
        page: props.page || 1,
        rect: props.rect || null,
        signerName: props.signerName
      });
      setData(res);
      setState('waiting');
      startCountdown(res?.expiresAt);
      startPolling(res?.tranId);
    } catch (e) {
      setError(e?.message || t('ca-initiate-failed'));
      setState('failed');
    }
  };

  const handleCancel = async () => {
    clearTimers();
    try {
      if (data?.tranId && state === 'waiting') await callCaCancel(props.Parse, data.tranId);
    } catch {
      /* best effort */
    }
    setState('cancelled');
  };

  const handleClose = () => {
    if (state === 'waiting') {
      // Keep the transaction alive on the server; only stop polling.
      clearTimers();
    }
    props?.onClose && props.onClose();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(data?.deepLinkUrl || data?.qrPayload || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const qrImg = data?.qrPayload
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.qrPayload)}`
    : null;

  return (
    <ModalUi isOpen={props.isOpen} title={t('ca-sign-external')} handleClose={handleClose}>
      <div className='p-4 md:p-5 text-[13px] md:text-sm'>
        <label className='font-medium'>{t('ca-provider')}</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          disabled={state === 'creating' || state === 'waiting'}
          className='op-input op-input-bordered w-full mt-1'
        >
          {CA_PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        {(state === 'idle' || state === 'failed' || state === 'expired' || state === 'cancelled') && (
          <button onClick={handleStart} className='op-btn op-btn-primary w-full mt-3'>
            {t('ca-create-request')}
          </button>
        )}

        {state === 'creating' && <p className='mt-3'>{t('ca-creating')}</p>}

        {data && (state === 'waiting' || state === 'signed') && (
          <div className='mt-3 flex flex-col items-center gap-2'>
            {qrImg && (
              <img src={qrImg} alt='CA QR' width={200} height={200} className='border rounded' />
            )}
            <p className='text-center text-base-content'>{t('ca-waiting-app')}</p>
            {(data.tranCode || data.docCode) && (
              <p className='text-center font-medium'>
                {t('ca-tran-code')}: {data.tranCode || data.docCode}
                {data.tranCode && data.docCode && data.tranCode !== data.docCode
                  ? ` / ${data.docCode}`
                  : ''}
              </p>
            )}
            <div className='flex gap-2 w-full'>
              {data.deepLinkUrl ? (
                <a href={data.deepLinkUrl} className='op-btn op-btn-secondary flex-1 text-center'>
                  {t('ca-open-app')}
                </a>
              ) : null}
              <button onClick={copyLink} className='op-btn op-btn-ghost flex-1'>
                {copied ? t('ca-copied') : t('ca-copy-link')}
              </button>
            </div>
            <p className='break-all text-[11px] opacity-70'>{data.qrPayload}</p>
            {secondsLeft != null && state === 'waiting' && (
              <p>
                {t('ca-expires-in')} {Math.floor(secondsLeft / 60)}:
                {String(secondsLeft % 60).padStart(2, '0')}
              </p>
            )}
            {state === 'waiting' && (
              <button onClick={handleCancel} className='op-btn op-btn-ghost w-full'>
                {t('ca-cancel')}
              </button>
            )}
          </div>
        )}

        {state === 'signed' && (
          <p className='mt-3 text-green-600 font-medium'>{t('ca-signed')}</p>
        )}
        {['failed', 'expired', 'cancelled'].includes(state) && (
          <p className='mt-3 text-red-500'>
            {t(`ca-${state}`)}
            {data?.errorMessage ? `: ${data.errorMessage}` : ''}
          </p>
        )}
        {error && <p className='mt-2 text-red-500'>{error}</p>}
        <p className='mt-3 text-[11px] opacity-60'>{t('ca-legal-note')}</p>
      </div>
    </ModalUi>
  );
}

export default CaSignModal;
