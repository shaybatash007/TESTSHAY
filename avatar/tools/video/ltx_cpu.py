"""Image-to-video with LTX-Video 2B 0.9.8 distilled on CPU (no GPU, no quota).

usage: python3 ltx_cpu.py image.jpg out.mp4 "prompt" [frames=49] [width=512] [height=768] [seed=7]
"""
import sys, time, gc, os
import torch
from PIL import Image
torch.set_num_threads(os.cpu_count())
W = '/tmp/claude-0/ltx'
img, out, prompt = sys.argv[1], sys.argv[2], sys.argv[3]
frames = int(sys.argv[4]) if len(sys.argv) > 4 else 49
width = int(sys.argv[5]) if len(sys.argv) > 5 else 512
height = int(sys.argv[6]) if len(sys.argv) > 6 else 768
seed = int(sys.argv[7]) if len(sys.argv) > 7 else 7
t0 = time.time()

# 1) text embeddings (T5-XXL bf16), cached per prompt, then the encoder is freed
from transformers import T5EncoderModel, T5TokenizerFast
import hashlib
key = hashlib.md5(prompt.encode()).hexdigest()[:12]; cache = f'{W}/emb_{key}.pt'
if os.path.exists(cache):
    emb, mask = torch.load(cache)
else:
    tok = T5TokenizerFast.from_pretrained(f'{W}/tok')
    enc = T5EncoderModel.from_pretrained(f'{W}/t5', torch_dtype=torch.bfloat16, low_cpu_mem_usage=True)
    ids = tok([prompt], padding='max_length', max_length=128, truncation=True, return_tensors='pt')
    with torch.no_grad(): emb = enc(ids.input_ids, attention_mask=ids.attention_mask)[0].float()
    mask = ids.attention_mask
    torch.save((emb, mask), cache); del enc; gc.collect()
print('text', round(time.time() - t0), flush=True)

# 2) transformer + VAE from the single-file distilled checkpoint
from diffusers import LTXConditionPipeline, LTXVideoTransformer3DModel, AutoencoderKLLTXVideo, FlowMatchEulerDiscreteScheduler
from diffusers.pipelines.ltx.pipeline_ltx_condition import LTXVideoCondition
from diffusers.utils import export_to_video
ck = f'{W}/ltxv-2b-0.9.8-distilled.safetensors'
tr = LTXVideoTransformer3DModel.from_single_file(ck, torch_dtype=torch.float32)
vae = AutoencoderKLLTXVideo.from_single_file(ck, torch_dtype=torch.float32)
sch = FlowMatchEulerDiscreteScheduler(use_dynamic_shifting=False, shift=1.0)
pipe = LTXConditionPipeline(transformer=tr, vae=vae, scheduler=sch, text_encoder=None, tokenizer=None)
pipe.vae.enable_tiling()
print('load', round(time.time() - t0), flush=True)
image = Image.open(img).convert('RGB').resize((width, height), Image.LANCZOS)
cond = LTXVideoCondition(image=image, frame_index=0)
g = torch.Generator().manual_seed(seed)
video = pipe(conditions=[cond], prompt_embeds=emb, prompt_attention_mask=mask, width=width, height=height, num_frames=frames,
             timesteps=[1000, 993, 987, 981, 975, 909, 725, 0.03], guidance_scale=1.0, decode_timestep=0.05, decode_noise_scale=0.025,
             image_cond_noise_scale=0.0, guidance_rescale=0.7, generator=g, output_type='pil').frames[0]
export_to_video(video, out, fps=24)
print('DONE', round(time.time() - t0), out, flush=True)
