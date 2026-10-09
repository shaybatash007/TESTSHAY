"""Minimal CPU LivePortrait (ONNX) runner: crop with MediaPipe landmarks, retarget pose / eyes / lips / expression, paste back."""
import numpy as np, cv2, onnxruntime as ort, time, os
from math import sin, cos, acos
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

M = '/tmp/claude-0/lp/models/'
so = ort.SessionOptions(); so.intra_op_num_threads = 4
def sess(n): return ort.InferenceSession(M + n, so, providers=['CPUExecutionProvider'])
S = {n: sess(n + '.onnx') for n in ['appearance_feature_extractor', 'motion_extractor', 'stitching', 'stitching_eye', 'stitching_lip', 'warping_spade']}
det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path='/tmp/claude-0/fl.task'), num_faces=1))

def landmarks(img_rgb):
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img_rgb)))
    l = r.face_landmarks[0]; h, w = img_rgb.shape[:2]
    return np.array([[p.x * w, p.y * h] for p in l], np.float32)

# ---- crop (adapted from LivePortrait) ----
def parse_rect(pts, scale=2.3, vx=0.0, vy=-0.125):
    pt2 = np.stack([(pts[468] + pts[473]) / 2, pts[14]], 0)
    uy = pt2[1] - pt2[0]; l = np.linalg.norm(uy); uy = uy / l
    ux = np.array((uy[1], -uy[0]), np.float32)
    angle = acos(ux[0]); angle = -angle if ux[1] < 0 else angle
    Mr = np.array([ux, uy]); c0 = pts.mean(0); rp = (pts - c0) @ Mr.T
    lt, rb = rp.min(0), rp.max(0); c1 = (lt + rb) / 2; size = rb - lt; m = max(size); size = np.array([m, m], np.float32) * scale
    center = c0 + ux * c1[0] + uy * c1[1]; center = center + ux * (vx * size) + uy * (vy * size)
    return center, size, angle
def crop(img, pts, dsize=512, scale=2.3, vy=-0.125):
    center, size, angle = parse_rect(pts, scale, 0.0, vy); s = dsize / size[0]; t = dsize / 2
    ct, st = cos(angle), sin(angle); cx, cy = center
    Minv = np.array([[s * ct, s * st, t - s * (ct * cx + st * cy)], [-s * st, s * ct, t - s * (-st * cx + ct * cy)]], np.float32)
    return cv2.warpAffine(img, Minv, (dsize, dsize), flags=cv2.INTER_LINEAR), Minv

def rotmat(pitch, yaw, roll):
    p, y, r = [np.asarray(v, np.float32).reshape(-1, 1) / 180 * np.pi for v in (pitch, yaw, roll)]
    bs = p.shape[0]; o, z = np.ones([bs, 1]), np.zeros([bs, 1])
    rx = np.concatenate([o, z, z, z, np.cos(p), -np.sin(p), z, np.sin(p), np.cos(p)], 1).reshape(bs, 3, 3)
    ry = np.concatenate([np.cos(y), z, np.sin(y), z, o, z, -np.sin(y), z, np.cos(y)], 1).reshape(bs, 3, 3)
    rz = np.concatenate([np.cos(r), -np.sin(r), z, np.sin(r), np.cos(r), z, z, z, o], 1).reshape(bs, 3, 3)
    return (rz @ ry @ rx).transpose(0, 2, 1)
def deg(pred):
    if pred.ndim > 1 and pred.shape[1] == 66:
        e = np.exp(pred - pred.max(1, keepdims=True)); e = e / e.sum(1, keepdims=True); return (e * np.arange(66)).sum(1) * 3 - 97.5
    return pred

def run(name, *a):
    s = S[name]; names = [i.name for i in s.get_inputs()]
    return s.run(None, dict(zip(names, a)))

class Source:
    def __init__(self, path, Minv=None):
        self.bgr = cv2.imread(path); self.rgb = cv2.cvtColor(self.bgr, cv2.COLOR_BGR2RGB)
        self.lmk = landmarks(self.rgb)
        self.crop, self.Minv = crop(self.rgb, self.lmk)
        if Minv is not None:
            self.Minv = Minv; self.crop = cv2.warpAffine(self.rgb, Minv, (512, 512), flags=cv2.INTER_LINEAR)
        self.M_c2o = np.linalg.inv(np.vstack([self.Minv, [0, 0, 1]]))[:2].astype(np.float32)
        I = cv2.resize(self.crop, (256, 256)).astype(np.float32) / 255
        x = I.transpose(2, 0, 1)[None]
        pitch, yaw, roll, t, exp, scale, kp = run('motion_extractor', x)
        self.pitch, self.yaw, self.roll = deg(pitch)[:, None], deg(yaw)[:, None], deg(roll)[:, None]
        self.t, self.exp, self.scale = t, exp.reshape(1, -1, 3), scale; self.kp = kp.reshape(1, -1, 3)
        self.f_s = run('appearance_feature_extractor', x)[0]
        R = rotmat(self.pitch, self.yaw, self.roll)
        self.x_s = self.transform(self.kp, R, self.exp, self.scale, self.t)
        mask = cv2.imread('/tmp/claude-0/lp/mask_template.png'); mask = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY) if mask.ndim == 3 else mask
        self.mask_ori = cv2.warpAffine(mask, self.M_c2o, (self.rgb.shape[1], self.rgb.shape[0]), flags=cv2.INTER_LINEAR).astype(np.float32)[..., None] / 255
        l = self.lmk
        self.eye_c = [self.ratio(l, 159, 145, 33, 133), self.ratio(l, 386, 374, 362, 263)]
        self.lip_c = self.ratio(l, 13, 14, 61, 291)
    @staticmethod
    def ratio(l, a, b, c, d): return float(np.linalg.norm(l[a] - l[b]) / (np.linalg.norm(l[c] - l[d]) + 1e-6))
    @staticmethod
    def transform(kp, R, exp, scale, t):
        k = kp @ R + exp; k = k * scale[..., None]; k[:, :, 0:2] += t[:, None, 0:2]; return k
    def stitch(self, kd):
        bs, n = self.x_s.shape[:2]
        d = run('stitching', np.concatenate([self.x_s.reshape(bs, -1), kd.reshape(bs, -1)], 1).astype(np.float32))[0]
        kd = kd.copy(); kd += d[..., :3 * n].reshape(bs, n, 3); kd[..., :2] += d[..., 3 * n:3 * n + 2].reshape(bs, 1, 2); return kd
    def frame(self, dp=0, dy=0, dr=0, exp_delta=None, eye=None, lip=None, dtx=0, dty=0, crop_only=False):
        """eye / lip: target openness ratios (None = leave as is). Returns the full-size RGB frame."""
        R = rotmat(self.pitch + dp, self.yaw + dy, self.roll + dr)
        exp = self.exp.copy()
        if exp_delta is not None: exp = exp + exp_delta
        t = self.t.copy(); t[..., 0] += dtx; t[..., 1] += dty; t[..., 2] = 0
        xd = self.transform(self.kp, R, exp, self.scale, t)
        delta = 0
        if eye is not None:
            ce = np.array([[ (self.eye_c[0] + self.eye_c[1]) / 2 * 0 + self.eye_c[0], self.eye_c[1], eye]], np.float32)
            delta = delta + run('stitching_eye', np.concatenate([self.x_s.reshape(1, -1), ce], 1).astype(np.float32))[0].reshape(1, -1, 3)
        if lip is not None:
            cl = np.array([[self.lip_c, lip]], np.float32)
            delta = delta + run('stitching_lip', np.concatenate([self.x_s.reshape(1, -1), cl], 1).astype(np.float32))[0].reshape(1, -1, 3)
        xd = xd + delta
        xd = self.stitch(xd)
        out = run('warping_spade', self.f_s, xd.astype(np.float32), self.x_s.astype(np.float32))[0]
        out = (np.clip(out[0].transpose(1, 2, 0), 0, 1) * 255).astype(np.float32)
        if crop_only: return out.astype(np.uint8)
        back = cv2.warpAffine(out, self.M_c2o, (self.rgb.shape[1], self.rgb.shape[0]), flags=cv2.INTER_LINEAR)
        return np.clip(self.mask_ori * back + (1 - self.mask_ori) * self.rgb, 0, 255).astype(np.uint8)
