import React from "react"
import ReactDOM from "react-dom/client";
import App from "./page";
import { createTheme, ThemeProvider } from "@mui/material/styles";

import "@fontsource/inter";
import "./globals.css";

const orangeTheme = createTheme({
  palette: {
    primary: {
      main: "#f97316",
      light: "#fb923c",
      dark: "#c2410c",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#f59e0b",
      contrastText: "#1c1917",
    },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: "linear-gradient(110deg, #c2410c 0%, #f97316 55%, #f59e0b 100%)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
  },
});

// To get rid of TS compilation errors
(() => { return React.StrictMode })();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ThemeProvider theme={orangeTheme}>
    <App />
  </ThemeProvider>
);
