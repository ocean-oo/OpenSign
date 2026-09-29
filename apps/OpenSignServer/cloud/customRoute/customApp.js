import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import docxtopdf, { upload as docxUpload } from './docxtopdf.js';
import decryptpdf, { upload as decryptUpload } from './decryptpdf.js';
import { deleteUserByAdmin, deleteUserPost } from './deleteAccount/deleteUser.js';
import { deleteUserGet } from './deleteAccount/deleteUserGet.js';
import { deleteUserOtp } from './deleteAccount/deleteUserOtp.js';
import { handleCaCallback } from '../ca/caService.js';

export const app = express();

dotenv.config({ quiet: true });
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.post('/docxtopdf', docxUpload.single('file'), docxtopdf);
app.post('/decryptpdf', decryptUpload.single('file'), decryptpdf);
app.get('/delete-account/:userId', deleteUserGet);
app.post('/delete-account/:userId/otp', deleteUserOtp);
app.post('/delete-account/:userId', deleteUserPost);
app.post('/deleteuser/:userId', deleteUserByAdmin);
// External CA webhook (VNPT/Viettel/mobile-app callbacks).
// Register the same URL in the CA partner portal (VNPT_CA_CALLBACK_URL /
// VIETTEL_CA_CALLBACK_URL). Raw-body HMAC verification is handled in the provider.
app.post('/ca/:provider/callback', async (req, res) => {
  try {
    const result = await handleCaCallback({
      provider: req.params.provider,
      body: req.body || {},
      headers: req.headers || {},
      rawBody: typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
    });
    res.json({ ok: true, status: result.status, tranId: result.tranId });
  } catch (e) {
    res.status(400).json({ ok: false, code: e?.code || 'INVALID_CALLBACK', message: e?.message });
  }
});
