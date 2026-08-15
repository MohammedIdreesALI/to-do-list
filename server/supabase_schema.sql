-- ============================================================================
-- TASKFLOW PRO - Supabase Cloud PostgreSQL Schema & Row Level Security (RLS)
-- Copy and paste this script directly into Supabase SQL Editor and click "Run".
-- ============================================================================

-- 1. Tasks Table
CREATE TABLE IF NOT EXISTS public.tasks (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT DEFAULT '',
    priority TEXT DEFAULT 'medium',
    category TEXT DEFAULT 'work',
    due_date TEXT DEFAULT '',
    completed BOOLEAN DEFAULT false,
    kanban_status TEXT DEFAULT 'todo',
    pinned BOOLEAN DEFAULT false,
    order_index INTEGER DEFAULT 0,
    created_at BIGINT NOT NULL,
    completed_at BIGINT DEFAULT NULL
);

-- 2. Subtasks Table
CREATE TABLE IF NOT EXISTS public.subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES public.tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed BOOLEAN DEFAULT false,
    order_index INTEGER DEFAULT 0
);

-- 3. Custom Categories Table
CREATE TABLE IF NOT EXISTS public.custom_categories (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3b82f6',
    created_at BIGINT NOT NULL
);

-- 4. User Stats Table
CREATE TABLE IF NOT EXISTS public.user_stats (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    xp INTEGER DEFAULT 0,
    streak_count INTEGER DEFAULT 1,
    last_active_date TEXT,
    theme TEXT DEFAULT 'light',
    sound_enabled BOOLEAN DEFAULT true
);

-- Enable Row Level Security (RLS) so each user only accesses their own tasks
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

-- Tasks Policies
CREATE POLICY "Users can manage their own tasks"
ON public.tasks FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Subtasks Policies
CREATE POLICY "Users can manage subtasks of their tasks"
ON public.subtasks FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.tasks WHERE tasks.id = subtasks.task_id AND tasks.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.tasks WHERE tasks.id = subtasks.task_id AND tasks.user_id = auth.uid()));

-- Categories Policies
CREATE POLICY "Users can manage their own categories"
ON public.custom_categories FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- User Stats Policies
CREATE POLICY "Users can manage their own stats"
ON public.user_stats FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
