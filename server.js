// ============================================================
// CONTROLYNX — server.js  (Clean rebuild — single source of truth)
// All DB reads use service role key via direct REST to bypass
// any Supabase client / RLS / key-format issues permanently.
// ============================================================
require('dotenv').config();
const express = require('express');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

// Supabase client — used ONLY for auth.signInWithPassword and auth.signUp
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Core DB helper — uses service role key, bypasses all RLS ─
// This is the ONLY way we talk to the database from the server.
// It always works regardless of RLS policies or key format.
async function db(method, table, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const base = process.env.SUPABASE_URL + '/rest/v1/' + table;

  const params = new URLSearchParams();
  if (opts.eq)     Object.entries(opts.eq).forEach(([k,v]) => params.append(k, `eq.${v}`));
  if (opts.select) params.append('select', opts.select);
  if (opts.order)  params.append('order', opts.order);
  if (opts.limit)  params.append('limit', opts.limit);
  if (opts.single) params.append('limit', '1');

  const url = base + (params.toString() ? '?' + params.toString() : '');
  const headers = {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (method === 'POST' || method === 'PATCH') headers['Prefer'] = 'return=representation';
  if (method === 'DELETE') headers['Prefer'] = 'return=minimal';

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch(e) { data = text; }

  if (!res.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data);
    throw new Error(`DB ${method} ${table} failed: ${msg}`);
  }
  if (opts.single) return Array.isArray(data) ? data[0] || null : data;
  return data;
}

// ── Auth middleware ──────────────────────────────────────────
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });
    req.user = data.user;
    req.profile = await db('GET', 'profiles', {
      eq: { id: data.user.id },
      select: '*,organizations(*)',
      single: true
    });
    next();
  } catch(e) {
    console.error('requireAuth:', e.message);
    return res.status(500).json({ error: 'Auth error: ' + e.message });
  }
}

// ── Health ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Controlynx API v2.0',
    supabase: !!process.env.SUPABASE_URL,
    service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY
  });
});

// ── Sign Up ──────────────────────────────────────────────────
// Creates auth user only. Supabase trigger handle_new_user()
// automatically creates the organization + profile row.
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, full_name, role, org_name, plan } = req.body;
  if (!email || !password || !full_name || !org_name) {
    return res.status(400).json({ error: 'Email, password, name and organisation are required.' });
  }
  const planLimits = {
    starter:      { max_projects: 1,   max_users: 5  },
    professional: { max_projects: 5,   max_users: 15 },
    enterprise:   { max_projects: 999, max_users: 9999 }
  };
  const limits = planLimits[plan] || planLimits.starter;

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name,
        role:         role || 'planner',
        org_name,
        plan:         plan || 'starter',
        max_projects: limits.max_projects,
        max_users:    limits.max_users
      }
    }
  });
  if (authError) return res.status(400).json({ error: authError.message });
  if (!authData.user) return res.status(400).json({ error: 'Failed to create account.' });

  // Return session token directly so the client can skip a separate signin
  res.json({
    success:       true,
    token:         authData.session?.access_token || null,
    refresh_token: authData.session?.refresh_token || null,
    user: {
      id:        authData.user.id,
      email:     authData.user.email,
      full_name: full_name,
      role:      role || 'planner'
    }
  });
});

// ── Sign In ──────────────────────────────────────────────────
app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });

  // Always use db() helper — never supabase client — for profile lookup
  const profile = await db('GET', 'profiles', {
    eq: { id: data.user.id },
    select: '*,organizations(*)',
    single: true
  }).catch(() => null);

  res.json({
    token:         data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: {
      id:           data.user.id,
      email:        data.user.email,
      full_name:    profile?.full_name || data.user.user_metadata?.full_name || data.user.email,
      role:         profile?.role      || data.user.user_metadata?.role      || 'planner',
      organization: profile?.organizations || null
    }
  });
});

// ── Sign Out ─────────────────────────────────────────────────
app.post('/api/auth/signout', requireAuth, async (req, res) => {
  await supabase.auth.signOut().catch(() => {});
  res.json({ success: true });
});

// ── Me ───────────────────────────────────────────────────────
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
  try {
    const orgId = req.profile?.organization_id;
    if (!orgId) return res.status(400).json({ error: 'No organisation found.' });
    const data = await db('GET', 'projects', {
      eq:    { organization_id: orgId, is_active: true },
      order: 'created_at.desc'
    });
    res.json(data);
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const data = await db('GET', 'projects', {
      eq:     { id: req.params.id },
      single: true
    });
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/projects', requireAuth, async (req, res) => {
  try {
    const userRole = req.profile?.role || req.user.user_metadata?.role || '';
    if (!['planner','admin'].includes(userRole)) {
      return res.status(403).json({ error: 'Only Planners can create projects.' });
    }

    const orgId = req.profile?.organization_id;
    if (!orgId) return res.status(400).json({ error: 'No organisation found. Please sign out and sign back in.' });

    // Check plan limit
    const existingProjects = await db('GET', 'projects', {
      eq: { organization_id: orgId, is_active: true }
    }).catch(() => []);
    const max = req.profile?.organizations?.max_projects || 1;
    if (existingProjects.length >= max) {
      return res.status(403).json({
        error: `Plan limit: ${max} project(s). Upgrade to add more.`,
        upgrade_required: true
      });
    }

    // Create project
    const projectData = {
      name:              req.body.name,
      client:            req.body.client            || null,
      pmc:               req.body.pmc               || null,
      consultant:        req.body.consultant         || null,
      contractor:        req.body.contractor         || null,
      contract_number:   req.body.contract_number   || null,
      start_date:        req.body.start_date         || null,
      planned_finish:    req.body.planned_finish      || null,
      report_prefix:     req.body.report_prefix      || 'DPR',
      site_lat:          req.body.site_lat            || null,
      site_lng:          req.body.site_lng            || null,
      distribution_list: req.body.distribution_list  || [],
      subcontractors:    req.body.subcontractors     || [],
      organization_id:   orgId,
      is_active:         true
    };

    const rows = await db('POST', 'projects', { body: projectData });
    const project = Array.isArray(rows) ? rows[0] : rows;
    if (!project?.id) return res.status(400).json({ error: 'Failed to create project.' });

    // Add creator as project member
    await db('POST', 'project_members', {
      body: { project_id: project.id, user_id: req.user.id, role: userRole }
    }).catch(() => {});

    res.json(project);
  } catch(e) {
    console.error('POST /api/projects:', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.patch('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const rows = await db('PATCH', 'projects', {
      eq:   { id: req.params.id },
      body: req.body
    });
    res.json(Array.isArray(rows) ? rows[0] : rows);
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── Daily Reports ────────────────────────────────────────────
app.get('/api/projects/:projectId/reports', requireAuth, async (req, res) => {
  try {
    const data = await db('GET', 'daily_reports', {
      eq:     { project_id: req.params.projectId },
      select: 'id,report_number,report_date,status,submitted_at,created_at',
      order:  'report_date.desc'
    });
    res.json(data);
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/reports/:id', requireAuth, async (req, res) => {
  try {
    const data = await db('GET', 'daily_reports', { eq: { id: req.params.id }, single: true });
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch(e) { res.status(404).json({ error: 'Not found' }); }
});

app.get('/api/projects/:projectId/today', requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Try to get existing draft report for today
    const existing = await db('GET', 'daily_reports', {
      eq:     { project_id: req.params.projectId, report_date: today, status: 'draft' },
      single: true
    }).catch(() => null);

    if (existing) return res.json(existing);

    // Create new report for today
    const project = await db('GET', 'projects', {
      eq: { id: req.params.projectId }, single: true
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const start  = new Date(project.start_date || Date.now());
    const dayNum = Math.max(1, Math.ceil((new Date() - start) / 86400000));
    const repNo  = `${project.report_prefix || 'DPR'}-${String(dayNum).padStart(4, '0')}`;

    // Carry forward incomplete activities from yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const prev = await db('GET', 'daily_reports', {
      eq:     { project_id: req.params.projectId, report_date: yesterday.toISOString().split('T')[0] },
      select: 'activities_items,allocation_items',
      single: true
    }).catch(() => null);

    const carriedActs  = (prev?.activities_items || [])
      .filter(a => a.status !== 'complete')
      .map(a => ({ ...a, carried_forward: true }));
    const carriedAlloc = (prev?.allocation_items || [])
      .filter((_, i) => (prev?.activities_items || [])[i]?.status !== 'complete');

    const rows = await db('POST', 'daily_reports', {
      body: {
        project_id:       req.params.projectId,
        organization_id:  req.profile?.organization_id,
        report_number:    repNo,
        report_date:      today,
        status:           'draft',
        activities_items: carriedActs,
        allocation_items: carriedAlloc
      }
    });
    const newReport = Array.isArray(rows) ? rows[0] : rows;
    res.json(newReport);
  } catch(e) {
    console.error('GET today:', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.patch('/api/reports/:id', requireAuth, async (req, res) => {
  try {
    const existing = await db('GET', 'daily_reports', { eq: { id: req.params.id }, single: true }).catch(() => null);
    if (existing?.status === 'locked') return res.status(403).json({ error: 'Report is locked' });
    const rows = await db('PATCH', 'daily_reports', {
      eq:   { id: req.params.id },
      body: { ...req.body, updated_at: new Date().toISOString() }
    });
    res.json(Array.isArray(rows) ? rows[0] : rows);
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/reports/:id/submit', requireAuth, async (req, res) => {
  try {
    if (!['planner','admin'].includes(req.profile?.role)) {
      return res.status(403).json({ error: 'Only Planners can submit reports' });
    }
    const rows = await db('PATCH', 'daily_reports', {
      eq:   { id: req.params.id },
      body: { status: 'submitted', submitted_by: req.user.id, submitted_at: new Date().toISOString() }
    });
    const report = Array.isArray(rows) ? rows[0] : rows;
    generateAINarrative(req.params.id, report).catch(console.error);
    res.json({ success: true, report_number: report?.report_number });
  } catch(e) { res.status(400).json({ error: e.message }); }
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
DATE: ${report.report_date}
WEATHER: ${report.weather_condition || 'N/A'}, ${report.weather_max_temp || 'N/A'}°C max
TOTAL DIRECT LABOUR: ${total}
TOOLBOX TALK: ${report.safety_toolbox_conducted === 'yes' ? 'Conducted' : 'Not conducted'} — ${report.safety_toolbox_topic || ''}
ACTIVITIES TODAY:
${acts.map(a => `• ${a.description} [${a.zone || ''}] — ${a.progress}% — ${a.status}`).join('\n') || 'None recorded'}
TOMORROW: ${report.activities_tomorrow_plan || 'TBC'}
ISSUES: ${issues.length === 0 ? 'None' : issues.map(i => `[${i.severity?.toUpperCase()}] ${i.description}`).join(' | ')}
Write 4 sections: 1) DAY SUMMARY 2) PRODUCTIVITY ANALYSIS 3) ISSUES & RISKS 4) TOMORROW READINESS. Professional, factual, concise. Internal use only.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const result = await resp.json();
    const narrative = result.content?.[0]?.text || '';
    await db('PATCH', 'daily_reports', {
      eq:   { id: reportId },
      body: { ai_narrative: narrative, ai_generated_at: new Date().toISOString() }
    });
  } catch(e) { console.error('AI error:', e.message); }
}

// ── Page routes ──────────────────────────────────────────────
app.get('/login',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login.html',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/signup',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/signup.html',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/setup',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'setup.html')));
app.get('/setup.html',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'setup.html')));
app.get('/dpr',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/privacy.html', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/security.html',(req, res) => res.sendFile(path.join(__dirname, 'security.html')));
app.get('/terms.html',   (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/',             (req, res) => res.sendFile(path.join(__dirname, 'landing.html')));
app.use('/logos',        express.static(path.join(__dirname, 'logos')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n Controlynx running at http://localhost:${PORT}`);
  console.log(`   Supabase     : ${process.env.SUPABASE_URL       ? 'Connected' : 'Check .env'}`);
  console.log(`   Service key  : ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set' : 'MISSING — signup will fail'}`);
  console.log(`   Claude       : ${process.env.ANTHROPIC_API_KEY  ? 'Ready'     : 'Add key to .env'}\n`);
});
