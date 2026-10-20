import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Engagement } from "@mockups/engagement";
import { LearningQuality } from "@mockups/learning-quality";
import { Workload } from "@mockups/workload";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/engagement" element={<Engagement />} />
        <Route path="/learning-quality" element={<LearningQuality />} />
        <Route path="/workload" element={<Workload />} />
        <Route path="*" element={<Navigate to="/engagement" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
