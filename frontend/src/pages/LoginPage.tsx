import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Mail, Lock, User, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const LoginPage: React.FC = () => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await register(email, password, name || undefined);
      } else {
        await login(email, password);
      }
      navigate('/');
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Something went wrong';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Branding */}
        <div className="login-brand">
          <div className="login-brand-icon">
            <FileText size={32} />
          </div>
          <h1>DocProcessor</h1>
          <p>Intelligent Document Processing & RAG Platform</p>
        </div>

        {/* Form Card */}
        <div className="login-card">
          <h2>{isRegister ? 'Create Account' : 'Welcome Back'}</h2>
          <p className="login-subtitle">
            {isRegister
              ? 'Sign up to start processing documents'
              : 'Sign in to your account'}
          </p>

          <form onSubmit={handleSubmit} className="login-form">
            {isRegister && (
              <div className="login-field">
                <User size={16} className="login-field-icon" />
                <input
                  type="text"
                  placeholder="Full Name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="form-input"
                  autoComplete="name"
                />
              </div>
            )}

            <div className="login-field">
              <Mail size={16} className="login-field-icon" />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
                required
                autoComplete="email"
              />
            </div>

            <div className="login-field">
              <Lock size={16} className="login-field-icon" />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-input"
                required
                minLength={6}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
            </div>

            {error && <div className="login-error">{error}</div>}

            <button
              type="submit"
              className="btn btn-primary login-submit"
              disabled={loading}
            >
              {loading
                ? 'Please wait...'
                : isRegister
                ? 'Create Account'
                : 'Sign In'}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <div className="login-toggle">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              className="login-toggle-btn"
              onClick={() => {
                setIsRegister(!isRegister);
                setError('');
              }}
            >
              {isRegister ? 'Sign In' : 'Sign Up'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
