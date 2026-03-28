import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ParrotFront from './pages/ParrotFront';
import ParrotAdmin from './pages/ParrotAdmin';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ParrotFront />} />
        <Route path="/admin" element={<ParrotAdmin />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;