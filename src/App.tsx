import React, { useState, useEffect } from "react";
import { 
  Mail, 
  MessageSquare, 
  GraduationCap, 
  LogOut, 
  RefreshCw, 
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  LogIn
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Task {
  id: string;
  source: "Gmail" | "Google Chat" | "Classroom";
  title: string;
  description: string;
  link: string;
  dueDate?: string;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"All" | "Gmail" | "Chat" | "Classroom">("All");

  useEffect(() => {
    checkAuth();
    
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsAuthenticated(true);
        fetchAllTasks();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        setIsAuthenticated(true);
        fetchAllTasks();
      } else {
        setIsAuthenticated(false);
      }
    } catch (err) {
      setIsAuthenticated(false);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await fetch("/api/auth/url");
      const { url } = await res.json();
      window.open(url, "oauth_popup", "width=600,height=700");
    } catch (err) {
      setError("ログインURLの取得に失敗しました");
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout");
    setIsAuthenticated(false);
    setTasks([]);
  };

  const fetchAllTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const [gmail, chat, classroom] = await Promise.all([
        fetch("/api/tasks/gmail").then(r => r.json()),
        fetch("/api/tasks/chat").then(r => r.json()),
        fetch("/api/tasks/classroom").then(r => r.json())
      ]);
      
      const allTasks = [...gmail, ...chat, ...classroom];
      setTasks(allTasks);
    } catch (err) {
      setError("タスクの取得中にエラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const filteredTasks = activeTab === "All" 
    ? tasks 
    : tasks.filter(t => t.source.includes(activeTab));

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl shadow-sm border border-stone-200 p-8 text-center"
        >
          <div className="w-16 h-16 bg-stone-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <GraduationCap className="w-8 h-8 text-stone-600" />
          </div>
          <h1 className="text-2xl font-semibold text-stone-900 mb-2">Workspace Task Hub</h1>
          <p className="text-stone-500 mb-8">
            Gmail, Chat, Classroom のタスクを<br />一箇所で管理しましょう。
          </p>
          <button
            onClick={handleLogin}
            className="w-full bg-stone-900 text-white rounded-xl py-3 font-medium flex items-center justify-center gap-2 hover:bg-stone-800 transition-colors"
          >
            <LogIn className="w-5 h-5" />
            Googleでログイン
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-stone-900 rounded-lg flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-lg tracking-tight">Task Hub</span>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={fetchAllTasks}
              disabled={loading}
              className="p-2 text-stone-500 hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={handleLogout}
              className="p-2 text-stone-500 hover:bg-stone-100 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Tabs */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {["All", "Gmail", "Chat", "Classroom"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab 
                  ? "bg-stone-900 text-white shadow-md" 
                  : "bg-white text-stone-500 border border-stone-200 hover:border-stone-300"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Task List */}
        <div className="grid gap-4">
          <AnimatePresence mode="popLayout">
            {loading && tasks.length === 0 ? (
              [1, 2, 3].map(i => (
                <div key={i} className="h-32 bg-stone-200 animate-pulse rounded-2xl" />
              ))
            ) : filteredTasks.length > 0 ? (
              filteredTasks.map((task) => (
                <motion.div
                  key={task.id}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="bg-white border border-stone-200 rounded-2xl p-5 hover:shadow-md transition-all group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`mt-1 p-2 rounded-xl ${
                        task.source === "Gmail" ? "bg-red-50 text-red-600" :
                        task.source === "Google Chat" ? "bg-emerald-50 text-emerald-600" :
                        "bg-blue-50 text-blue-600"
                      }`}>
                        {task.source === "Gmail" && <Mail className="w-5 h-5" />}
                        {task.source === "Google Chat" && <MessageSquare className="w-5 h-5" />}
                        {task.source === "Classroom" && <GraduationCap className="w-5 h-5" />}
                      </div>
                      <div>
                        <h3 className="font-semibold text-stone-900 mb-1 leading-tight">
                          {task.title}
                        </h3>
                        <p className="text-stone-500 text-sm line-clamp-2 mb-2">
                          {task.description}
                        </p>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 bg-stone-100 px-2 py-0.5 rounded">
                            {task.source}
                          </span>
                          {task.dueDate && (
                            <span className="text-xs text-stone-400 font-medium">
                              Due: {task.dueDate}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <a 
                      href={task.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="p-2 text-stone-300 group-hover:text-stone-900 transition-colors"
                    >
                      <ExternalLink className="w-5 h-5" />
                    </a>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="text-center py-20">
                <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-stone-300" />
                </div>
                <h3 className="text-stone-900 font-medium">タスクはありません</h3>
                <p className="text-stone-400 text-sm">すべて完了しています！</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
