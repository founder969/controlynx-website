// ============================================================
// CONTROLYNX — server.js (Sprint 1 — Final)
// ============================================================
require('dotenv').config();
const express = require('express');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Admin client using service role key — bypasses RLS for server-side operations
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Auth middleware ──────────────────────────────────────────
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  const token = header.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  req.user = user;
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, organizations(*)')
    .eq('id', user.id)
    .single();
  req.profile = profile;
  next();
}

// ── Health ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Controlynx API v1.0' });
});

// ── Auth routes ──────────────────────────────────────────────
app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, organizations(*)')
    .eq('id', data.user.id)
    .single();
  // If no profile exists yet, create org + profile from metadata (first login after signup)
  if (!profile) {
    const meta = data.user.user_metadata || {};
    const orgName = meta.org_name || 'My Organisation';
    const userRole = meta.role || 'planner';
    const plan = meta.plan || 'starter';
    const maxProjects = meta.max_projects || 1;
    const maxUsers = meta.max_users || 5;

    // Create org
    const { data: newOrg } = await supabase
      .from('organizations')
      .insert({ name: orgName, plan, max_projects: maxProjects, max_users: maxUsers })
      .select().single();

    // Create profile
    if (newOrg) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        full_name: meta.full_name || data.user.email,
        role: userRole,
        organization_id: newOrg.id,
        is_active: true
      });
    }

    return res.json({
      token:         data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id:           data.user.id,
        email:        data.user.email,
        full_name:    meta.full_name || data.user.email,
        role:         userRole,
        organization: newOrg || null
      }
    });
  }

  res.json({
    token:         data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: {
      id:           data.user.id,
      email:        data.user.email,
      full_name:    profile?.full_name || data.user.email,
      role:         profile?.role || data.user.user_metadata?.role || 'planner',
      organization: profile?.organizations || null
    }
  });
});

// Sign up - creates user + organization
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, full_name, role, org_name, plan, sector, market } = req.body;
  if (!email || !password || !full_name || !org_name) {
    return res.status(400).json({ error: 'Email, password, name and organisation are required.' });
  }

  // Plan limits
  const planLimits = { starter:{max_projects:1,max_users:5}, professional:{max_projects:5,max_users:15}, enterprise:{max_projects:999,max_users:9999} };
  const limits = planLimits[plan] || planLimits.starter;

  // 1. Create user with standard signUp
  // Store org_name and plan in user metadata — profile will be created on first signin
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name,
        role: role || 'planner',
        org_name,
        plan: plan || 'starter',
        max_projects: limits.max_projects,
        max_users: limits.max_users
      },
      emailRedirectTo: null
    }
  });
  if (authError) return res.status(400).json({ error: authError.message });
  if (!authData.user) return res.status(400).json({ error: 'Failed to create user account.' });

  res.json({ success: true, message: 'Account created successfully.' });
});

app.post('/api/auth/signout', requireAuth, async (req, res) => {
  await supabase.auth.signOut();
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({
    id:           req.user.id,
    email:        req.user.email,
    full_name:    req.profile?.full_name,
    role:         req.profile?.role,
    organization: req.profile?.organizations
  });
});

// ── Projects ─────────────────────────────────────────────────
app.get('/api/projects', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('organization_id', req.profile.organization_id)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/projects/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('projects').select('*')
    .eq('id', req.params.id)
    .eq('organization_id', req.profile.organization_id)
    .single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

app.post('/api/projects', requireAuth, async (req, res) => {
  if (!['planner','admin'].includes(req.profile?.role)) {
    return res.status(403).json({ error: 'Only Planners can create projects' });
  }
  const { count } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', req.profile.organization_id)
    .eq('is_active', true);
  const max = req.profile?.organizations?.max_projects || 1;
  if (count >= max) {
    return res.status(403).json({ error: `Plan limit: ${max} project(s). Upgrade to add more.`, upgrade_required: true });
  }
  const { data, error } = await supabase
    .from('projects')
    .insert({ ...req.body, organization_id: req.profile.organization_id })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  await supabase.from('project_members').insert({ project_id: data.id, user_id: req.user.id, role: req.profile.role });
  res.json(data);
});

app.patch('/api/projects/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('projects').update(req.body)
    .eq('id', req.params.id)
    .eq('organization_id', req.profile.organization_id)
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ── Daily Reports ────────────────────────────────────────────
app.get('/api/projects/:projectId/reports', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('daily_reports')
    .select('id, report_number, report_date, status, submitted_at, created_at')
    .eq('project_id', req.params.projectId)
    .order('report_date', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/reports/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('daily_reports').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

app.get('/api/projects/:projectId/today', requireAuth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  let { data: report } = await supabase
    .from('daily_reports').select('*')
    .eq('project_id', req.params.projectId)
    .eq('report_date', today)
    .eq('status', 'draft')
    .maybeSingle();

  if (!report) {
    const { data: project } = await supabase
      .from('projects').select('*').eq('id', req.params.projectId).single();
    const start  = new Date(project.start_date || Date.now());
    const dayNum = Math.max(1, Math.ceil((Date.now() - start) / 86400000));
    const repNo  = `${project.report_prefix}-${String(dayNum).padStart(4,'0')}`;
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const { data: prev } = await supabase
      .from('daily_reports').select('activities_items, allocation_items')
      .eq('project_id', req.params.projectId)
      .eq('report_date', yesterday.toISOString().split('T')[0])
      .maybeSingle();
    const carriedActs  = prev?.activities_items?.filter(a => a.status !== 'complete').map(a => ({ ...a, carried_forward: true })) || [];
    const carriedAlloc = prev?.allocation_items?.filter((_, i) => prev.activities_items?.[i]?.status !== 'complete') || [];
    const { data: newRep, error } = await supabase
      .from('daily_reports')
      .insert({ project_id: req.params.projectId, organization_id: req.profile.organization_id, report_number: repNo, report_date: today, activities_items: carriedActs, allocation_items: carriedAlloc })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });
    report = newRep;
  }
  res.json(report);
});

app.patch('/api/reports/:id', requireAuth, async (req, res) => {
  const { data: existing } = await supabase.from('daily_reports').select('status').eq('id', req.params.id).single();
  if (existing?.status === 'locked') return res.status(403).json({ error: 'Report is locked' });
  const { data, error } = await supabase
    .from('daily_reports').update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/reports/:id/submit', requireAuth, async (req, res) => {
  if (!['planner','admin'].includes(req.profile?.role)) {
    return res.status(403).json({ error: 'Only Planners can submit reports' });
  }
  const { data: report, error } = await supabase
    .from('daily_reports')
    .update({ status: 'submitted', submitted_by: req.user.id, submitted_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('status', 'draft').select().single();
  if (error) return res.status(400).json({ error: error.message });
  generateAINarrative(req.params.id, report).catch(console.error);
  res.json({ success: true, report_number: report.report_number });
});

// ── AI Narrative ─────────────────────────────────────────────
async function generateAINarrative(reportId, report) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  try {
    const acts   = report.activities_items || [];
    const issues = report.issues_items || [];
    const labour = report.labour_main_contractor?.trades || [];
    const total  = labour.reduce((a, t) => a + (parseInt(t.count) || 0), 0);
    const prompt = `You are a Senior Project Controls Engineer. Generate a concise internal DPR narrative.
DATE: ${report.report_date} | SHIFT: ${report.shift}
WEATHER: ${report.weather_condition}, ${report.weather_max_temp}°C max, ${report.weather_humidity}% humidity
TOTAL DIRECT LABOUR: ${total} | MAN HOURS: ${report.safety_man_hours || 'N/A'}
TOOLBOX TALK: ${report.safety_toolbox_conducted === 'yes' ? 'Conducted' : 'Not conducted'} — ${report.safety_toolbox_topic || ''}
ACTIVITIES TODAY:\n${acts.map(a => `• ${a.description} [${a.zone}] — ${a.progress}% — ${a.status}`).join('\n') || 'None recorded'}
TOMORROW: ${report.activities_tomorrow_plan || 'TBC'}
ISSUES: ${issues.length === 0 ? 'None' : issues.map(i => `[${i.severity?.toUpperCase()}] ${i.description}`).join(' | ')}
Write 4 sections: 1) DAY SUMMARY 2) PRODUCTIVITY ANALYSIS 3) ISSUES & RISKS 4) TOMORROW READINESS. Professional, factual, concise. Internal use only.`;
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
    });
    const result = await resp.json();
    await supabase.from('daily_reports').update({ ai_narrative: result.content?.[0]?.text || '', ai_generated_at: new Date().toISOString() }).eq('id', reportId);
  } catch (e) { console.error('AI error:', e.message); }
}

// ── PAGE ROUTES (order matters — specific before generic) ────
app.get('/login',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/signup',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/signup.html',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/setup',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'setup.html')));
app.get('/setup.html',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'setup.html')));
app.get('/login.html',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dpr',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/privacy.html', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/security.html',(req, res) => res.sendFile(path.join(__dirname, 'security.html')));
app.get('/terms.html',   (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/',             (req, res) => res.sendFile(path.join(__dirname, 'landing.html')));

// Serve static assets (CSS, JS, images) from public folder
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/logos',  express.static(path.join(__dirname, 'logos')));

// All other routes → DPR app
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Controlynx running at http://localhost:${PORT}`);
  console.log(`   Supabase : ${process.env.SUPABASE_URL ? '✓ Connected' : '✗ Check .env'}`);
  console.log(`   Claude   : ${process.env.ANTHROPIC_API_KEY ? '✓ Ready' : '⚠ Add key to .env'}\n`);
});
