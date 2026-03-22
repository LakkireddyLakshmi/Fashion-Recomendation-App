import React, { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../../lib/utils";
import { TextGenerateEffect } from "./text-generate-effect";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// ── Canvas Reveal Effect ──────────────────────────────────────────────

export const CanvasRevealEffect = ({
  animationSpeed = 10,
  opacities = [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1],
  colors = [[0, 255, 255]],
  containerClassName,
  dotSize,
  showGradient = true,
  reverse = false,
}) => {
  return (
    <div className={cn("h-full relative w-full", containerClassName)}>
      <div className="h-full w-full">
        <DotMatrix
          colors={colors ?? [[0, 255, 255]]}
          dotSize={dotSize ?? 3}
          opacities={opacities ?? [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1]}
          shader={`${reverse ? "u_reverse_active" : "false"}_;animation_speed_factor_${animationSpeed.toFixed(1)}_;`}
          center={["x", "y"]}
        />
      </div>
      {showGradient && (
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
      )}
    </div>
  );
};

const DotMatrix = ({
  colors = [[0, 0, 0]],
  opacities = [0.04, 0.04, 0.04, 0.04, 0.04, 0.08, 0.08, 0.08, 0.08, 0.14],
  totalSize = 20,
  dotSize = 2,
  shader = "",
  center = ["x", "y"],
}) => {
  const uniforms = useMemo(() => {
    let colorsArray = [colors[0], colors[0], colors[0], colors[0], colors[0], colors[0]];
    if (colors.length === 2) colorsArray = [colors[0], colors[0], colors[0], colors[1], colors[1], colors[1]];
    else if (colors.length === 3) colorsArray = [colors[0], colors[0], colors[1], colors[1], colors[2], colors[2]];
    return {
      u_colors: { value: colorsArray.map((c) => [c[0] / 255, c[1] / 255, c[2] / 255]), type: "uniform3fv" },
      u_opacities: { value: opacities, type: "uniform1fv" },
      u_total_size: { value: totalSize, type: "uniform1f" },
      u_dot_size: { value: dotSize, type: "uniform1f" },
      u_reverse: { value: shader.includes("u_reverse_active") ? 1 : 0, type: "uniform1i" },
    };
  }, [colors, opacities, totalSize, dotSize, shader]);

  return (
    <Shader
      source={`
        precision mediump float;
        in vec2 fragCoord;
        uniform float u_time;
        uniform float u_opacities[10];
        uniform vec3 u_colors[6];
        uniform float u_total_size;
        uniform float u_dot_size;
        uniform vec2 u_resolution;
        uniform int u_reverse;
        out vec4 fragColor;
        float PHI = 1.61803398874989484820459;
        float random(vec2 xy) { return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x); }
        float map(float value, float min1, float max1, float min2, float max2) { return min2 + (value - min1) * (max2 - min2) / (max1 - min1); }
        void main() {
            vec2 st = fragCoord.xy;
            ${center.includes("x") ? "st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));" : ""}
            ${center.includes("y") ? "st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));" : ""}
            float opacity = step(0.0, st.x);
            opacity *= step(0.0, st.y);
            vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));
            float frequency = 5.0;
            float show_offset = random(st2);
            float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
            opacity *= u_opacities[int(rand * 10.0)];
            opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
            opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));
            vec3 color = u_colors[int(show_offset * 6.0)];
            float animation_speed_factor = 0.5;
            vec2 center_grid = u_resolution / 2.0 / u_total_size;
            float dist_from_center = distance(center_grid, st2);
            float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);
            float max_grid_dist = distance(center_grid, vec2(0.0, 0.0));
            float timing_offset_outro = (max_grid_dist - dist_from_center) * 0.02 + (random(st2 + 42.0) * 0.2);
            float current_timing_offset;
            if (u_reverse == 1) {
                current_timing_offset = timing_offset_outro;
                opacity *= 1.0 - step(current_timing_offset, u_time * animation_speed_factor);
                opacity *= clamp((step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
            } else {
                current_timing_offset = timing_offset_intro;
                opacity *= step(current_timing_offset, u_time * animation_speed_factor);
                opacity *= clamp((1.0 - step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
            }
            fragColor = vec4(color, opacity);
            fragColor.rgb *= fragColor.a;
        }`}
      uniforms={uniforms}
      maxFps={60}
    />
  );
};

const ShaderMaterial = ({ source, uniforms, maxFps = 60 }) => {
  const { size } = useThree();
  const ref = useRef(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.material.uniforms.u_time.value = clock.getElapsedTime();
  });

  const getUniforms = () => {
    const prepared = {};
    for (const name in uniforms) {
      const u = uniforms[name];
      switch (u.type) {
        case "uniform1f": prepared[name] = { value: u.value, type: "1f" }; break;
        case "uniform1i": prepared[name] = { value: u.value, type: "1i" }; break;
        case "uniform3f": prepared[name] = { value: new THREE.Vector3().fromArray(u.value), type: "3f" }; break;
        case "uniform1fv": prepared[name] = { value: u.value, type: "1fv" }; break;
        case "uniform3fv": prepared[name] = { value: u.value.map((v) => new THREE.Vector3().fromArray(v)), type: "3fv" }; break;
        case "uniform2f": prepared[name] = { value: new THREE.Vector2().fromArray(u.value), type: "2f" }; break;
      }
    }
    prepared["u_time"] = { value: 0, type: "1f" };
    prepared["u_resolution"] = { value: new THREE.Vector2(size.width * 2, size.height * 2) };
    return prepared;
  };

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: `
        precision mediump float;
        in vec2 coordinates;
        uniform vec2 u_resolution;
        out vec2 fragCoord;
        void main(){
          float x = position.x;
          float y = position.y;
          gl_Position = vec4(x, y, 0.0, 1.0);
          fragCoord = (position.xy + vec2(1.0)) * 0.5 * u_resolution;
          fragCoord.y = u_resolution.y - fragCoord.y;
        }`,
      fragmentShader: source,
      uniforms: getUniforms(),
      glslVersion: THREE.GLSL3,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
    });
  }, [size.width, size.height, source]);

  return (
    <mesh ref={ref}>
      <planeGeometry args={[2, 2]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
};

const Shader = ({ source, uniforms, maxFps = 60 }) => {
  return (
    <Canvas className="absolute inset-0 h-full w-full">
      <ShaderMaterial source={source} uniforms={uniforms} maxFps={maxFps} />
    </Canvas>
  );
};

// ── Sign In Page ──────────────────────────────────────────────────────

const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "441654168539-vn4ht168i2fo4hk2rqggapla75jf4hds.apps.googleusercontent.com";

export const SignInPage = ({ className, onAuth }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState("email"); // "email" | "password" | "success"
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [initialCanvasVisible, setInitialCanvasVisible] = useState(true);
  const [reverseCanvasVisible, setReverseCanvasVisible] = useState(false);
  const googleBtnRef = useRef(null);

  // Load Google Identity Services
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      if (window.google && googleBtnRef.current) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleResponse,
        });
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "filled_black",
          size: "large",
          width: 380,
          text: "continue_with",
          shape: "pill",
          logo_alignment: "center",
        });
      }
    };
    document.body.appendChild(script);
    return () => { try { document.body.removeChild(script); } catch (e) { /* ignore */ } };
  }, []);

  const handleGoogleResponse = async (response) => {
    setLoading(true);
    setError("");
    try {
      const payload = JSON.parse(atob(response.credential.split(".")[1]));
      const googleEmail = payload.email;
      const googleName = payload.name || payload.given_name || googleEmail.split("@")[0];

      // Trigger success animation
      setReverseCanvasVisible(true);
      setTimeout(() => setInitialCanvasVisible(false), 50);

      try {
        const r = await fetch(`${API}/api/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: googleEmail, password: response.credential.slice(0, 32), name: googleName }),
          signal: AbortSignal.timeout(15000),
        });
        const data = await r.json();
        if (data.token) sessionStorage.setItem("hueiq_token", data.token);
        setTimeout(() => {
          setStep("success");
          setTimeout(() => onAuth({ email: googleEmail, name: googleName, token: data.token, isNewUser: true }), 1500);
        }, 1500);
      } catch (_regErr) {
        const r = await fetch(`${API}/api/auth/login`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: googleEmail, password: response.credential.slice(0, 32) }),
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          const data = await r.json();
          if (data.token) sessionStorage.setItem("hueiq_token", data.token);
          setTimeout(() => {
            setStep("success");
            setTimeout(() => onAuth({ email: googleEmail, name: googleName, token: data.token, isNewUser: false }), 1500);
          }, 1500);
        } else {
          setTimeout(() => {
            setStep("success");
            setTimeout(() => onAuth({ email: googleEmail, name: googleName, token: null, isNewUser: true }), 1500);
          }, 1500);
        }
      }
    } catch (err) {
      setError("Google sign-in failed. Please try again.");
      setLoading(false);
    }
  };

  const handleEmailSubmit = (e) => {
    e.preventDefault();
    if (email) setStep("password");
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError("");
    try {
      if (isLogin) {
        const r = await fetch(`${API}/api/auth/login`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || "Login failed"); }
        const data = await r.json();
        if (data.token) sessionStorage.setItem("hueiq_token", data.token);
        // Success animation
        setReverseCanvasVisible(true);
        setTimeout(() => setInitialCanvasVisible(false), 50);
        setTimeout(() => {
          setStep("success");
          setTimeout(() => onAuth({ email: email.trim(), name: data.name || email.split("@")[0], token: data.token, isNewUser: false }), 1500);
        }, 1500);
      } else {
        if (!name.trim()) { setError("Please enter your name"); setLoading(false); return; }
        const r = await fetch(`${API}/api/auth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || "Registration failed"); }
        const data = await r.json();
        if (data.token) sessionStorage.setItem("hueiq_token", data.token);
        setReverseCanvasVisible(true);
        setTimeout(() => setInitialCanvasVisible(false), 50);
        setTimeout(() => {
          setStep("success");
          setTimeout(() => onAuth({ email: email.trim(), name: name.trim(), token: data.token, isNewUser: true }), 1500);
        }, 1500);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className={cn("flex w-full flex-col min-h-screen bg-black relative", className)}>
      {/* Background Canvas */}
      <div className="absolute inset-0 z-0">
        {initialCanvasVisible && (
          <div className="absolute inset-0">
            <CanvasRevealEffect animationSpeed={3} containerClassName="bg-black" colors={[[255, 255, 255], [255, 255, 255]]} dotSize={6} reverse={false} />
          </div>
        )}
        {reverseCanvasVisible && (
          <div className="absolute inset-0">
            <CanvasRevealEffect animationSpeed={4} containerClassName="bg-black" colors={[[255, 255, 255], [255, 255, 255]]} dotSize={6} reverse={true} />
          </div>
        )}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(0,0,0,1)_0%,_transparent_100%)]" />
        <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-black to-transparent" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col flex-1 items-center justify-center min-h-screen">
        {/* Centered container */}
        <div className="w-full max-w-100 px-6">
          {/* Logo */}
          <div className="flex items-center justify-center mb-12">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-black font-bold text-base">H</div>
              <span className="text-white font-semibold text-xl tracking-tight">HueIQ</span>
            </div>
          </div>
            <AnimatePresence mode="wait">
              {step === "email" ? (
                <motion.div
                  key="email-step"
                  initial={{ opacity: 0, x: -100 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="text-center"
                >
                  <div className="mb-14">
                    <TextGenerateEffect
                      words={isLogin ? "Welcome back" : "Get started"}
                      className="text-5xl tracking-tight"
                      duration={0.6}
                    />
                    <p className="text-lg text-white/50 font-light mt-4">Your AI fashion stylist</p>
                  </div>

                  <div>
                    {/* Google Sign-In */}
                    <div ref={googleBtnRef} className="flex justify-center [&_iframe]:!w-full [&>div]:!w-full" />

                    <div className="flex items-center gap-4 my-10">
                      <div className="h-px bg-white/10 flex-1" />
                      <span className="text-white/40 text-sm">or</span>
                      <div className="h-px bg-white/10 flex-1" />
                    </div>

                    <form onSubmit={handleEmailSubmit}>
                      <div className="relative">
                        <input
                          type="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full backdrop-blur-sm text-white border border-white/10 rounded-full py-5 px-8 pr-16 focus:outline-none focus:border-white/30 text-center bg-transparent text-lg"
                          required
                        />
                        <button
                          type="submit"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-white w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors group overflow-hidden text-lg"
                        >
                          <span className="relative w-full h-full block overflow-hidden">
                            <span className="absolute inset-0 flex items-center justify-center transition-transform duration-300 group-hover:translate-x-full">→</span>
                            <span className="absolute inset-0 flex items-center justify-center transition-transform duration-300 -translate-x-full group-hover:translate-x-0">→</span>
                          </span>
                        </button>
                      </div>
                    </form>
                  </div>

                  <p className="text-sm text-white/40 mt-12">
                    {isLogin ? "Don't have an account? " : "Already have an account? "}
                    <button
                      onClick={() => { setIsLogin(!isLogin); setError(""); }}
                      className="underline text-white/60 hover:text-white transition-colors bg-transparent border-none cursor-pointer font-medium"
                    >
                      {isLogin ? "Sign up" : "Sign in"}
                    </button>
                  </p>
                </motion.div>
              ) : step === "password" ? (
                <motion.div
                  key="password-step"
                  initial={{ opacity: 0, x: 100 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 100 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="space-y-6 text-center"
                >
                  <div className="space-y-1">
                    <h1 className="text-4xl font-bold tracking-tight text-white">
                      {isLogin ? "Enter password" : "Create account"}
                    </h1>
                    <p className="text-lg text-white/50 font-light">{email}</p>
                  </div>

                  <form onSubmit={handlePasswordSubmit} className="space-y-4">
                    {!isLogin && (
                      <input
                        type="text"
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full backdrop-blur-sm text-white border border-white/10 rounded-full py-3 px-5 focus:outline-none focus:border-white/30 text-center bg-transparent"
                      />
                    )}
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full backdrop-blur-sm text-white border border-white/10 rounded-full py-3 px-5 focus:outline-none focus:border-white/30 text-center bg-transparent"
                      autoFocus
                      required
                    />

                    {error && (
                      <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-2">
                        {error}
                      </div>
                    )}

                    <div className="flex w-full gap-3">
                      <motion.button
                        type="button"
                        onClick={() => { setStep("email"); setPassword(""); setError(""); }}
                        className="rounded-full bg-white text-black font-medium px-8 py-3 hover:bg-white/90 transition-colors w-[30%]"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        Back
                      </motion.button>
                      <motion.button
                        type="submit"
                        disabled={loading || !password.trim()}
                        className={cn(
                          "flex-1 rounded-full font-medium py-3 border transition-all duration-300",
                          password.trim() && !loading
                            ? "bg-white text-black border-transparent hover:bg-white/90 cursor-pointer"
                            : "bg-[#111] text-white/50 border-white/10 cursor-not-allowed"
                        )}
                        whileHover={password.trim() ? { scale: 1.02 } : {}}
                        whileTap={password.trim() ? { scale: 0.98 } : {}}
                      >
                        {loading ? "Processing..." : isLogin ? "Sign in" : "Create account"}
                      </motion.button>
                    </div>
                  </form>
                </motion.div>
              ) : (
                <motion.div
                  key="success-step"
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: "easeOut", delay: 0.3 }}
                  className="space-y-6 text-center"
                >
                  <div className="space-y-1">
                    <h1 className="text-4xl font-bold tracking-tight text-white">You're in!</h1>
                    <p className="text-xl text-white/50 font-light">Welcome to HueIQ</p>
                  </div>

                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.5 }}
                    className="py-10"
                  >
                    <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-white to-white/70 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-black" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
  );
};
