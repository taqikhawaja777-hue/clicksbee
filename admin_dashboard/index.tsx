import React from 'react';
import ReactDOM from 'react-dom/client';
import Dashboard from './dashboard';
import { EmployeeProvider } from './EmployeeContext';
import { UpdateStatusIndicator } from './UpdateStatus';
import './index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <EmployeeProvider>
        <Dashboard />
        <UpdateStatusIndicator />
      </EmployeeProvider>
    </React.StrictMode>
  );
}
