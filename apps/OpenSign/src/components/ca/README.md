# External CA signing — frontend integration (Phase 1: CEO)

Component: `src/components/ca/CaSignModal.jsx`
Helpers: `src/constant/caUtils.js`

## 1. Env (frontend)

```
REACT_APP_CA_ENABLED=true
REACT_APP_CA_CEO_IDS=<ceo Parse user objectId>
REACT_APP_CA_CEO_EMAILS=ceo@company.vn
REACT_APP_CA_POLL_MS=3000
REACT_APP_CA_SHOW_MOCK=true   # dev only — shows Mock CA in the dropdown
```

Server is authoritative (`CA_CEO_USER_IDS` in server env). These only hide the button early.

## 2. Mount the button (example for a signing page)

```jsx
import { useState } from 'react';
import Parse from 'parse';
import CaSignModal from '../components/ca/CaSignModal';
import { canShowExternalCa } from '../constant/caUtils';

const [caOpen, setCaOpen] = useState(false);
const currentUser = Parse.User.current()?.toJSON?.() || null;

{canShowExternalCa(currentUser) && (
  <button className='op-btn op-btn-secondary' onClick={() => setCaOpen(true)}>
    {t('ca-sign-external')}
  </button>
)}

<CaSignModal
  isOpen={caOpen}
  onClose={() => setCaOpen(false)}
  Parse={Parse}
  documentId={docId}
  signerName={currentUser?.name || currentUser?.email}
  signerTitle='CEO'
  page={1}
  rect={null}
  onSigned={(res) => window.location.reload()}
/>
```

Suggested mount points: `PlaceHolderSign.jsx` (signer view) and
`PdfRequestFiles.jsx` (owner view). Keep the existing Finish flow untouched —
external CA is an additional button.

## 3. Flow

idle -> creating (`caInitiate`) -> waiting (QR + deeplink + poll `caStatus`
every REACT_APP_CA_POLL_MS) -> signed (auto `caComplete`, audit appended) |
failed | expired | cancelled (`caCancel`).
