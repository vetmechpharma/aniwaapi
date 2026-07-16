import React, { useEffect, useState } from "react";
import axios from "axios";

export function useSiteInfo() {
  const [info, setInfo] = useState({ company_name: "WA_API", contact_email: "", contact_phone: "" });
  useEffect(() => {
    axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/site-info`)
      .then(({ data }) => setInfo(data)).catch(() => {});
  }, []);
  return info;
}
