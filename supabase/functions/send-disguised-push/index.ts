// Supabase Edge Function: send-disguised-push
// Deploy with: supabase functions deploy send-disguised-push --no-verify-jwt
// Configure a Supabase Database Webhook on table `public.messages` (Event: INSERT)
// pointing to this function URL with an `x-webhook-secret` header if desired.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const DISGUISED_MESSAGES = [
  'Tip: Rotate or tap +/- for quick sign conversion.',
  'Memory register cleared.',
  'Precision calculation engine ready.',
  'Daily calculation summary updated.',
];

Deno.serve(async (req) => {
  try {
    const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET');
    if (webhookSecret && req.headers.get('x-webhook-secret') !== webhookSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const record = body?.record;
    if (!record?.sender_id) {
      return new Response(JSON.stringify({ ignored: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase env vars' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: tokens, error } = await admin
      .from('user_push_tokens')
      .select('expo_push_token, platform')
      .neq('user_id', record.sender_id);

    if (error || !tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pick = DISGUISED_MESSAGES[Math.floor(Math.random() * DISGUISED_MESSAGES.length)];
    const pushPayloads = tokens.map((row) => ({
      to: row.expo_push_token,
      title: 'SmartCalc',
      body: pick,
      sound: 'default',
      priority: 'high',
      ...(row.platform === 'android' ? { channelId: 'smartcalc_tips' } : {}),
    }));

    const expoResp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pushPayloads),
    });

    const result = await expoResp.json();
    return new Response(JSON.stringify({ sent: pushPayloads.length, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
