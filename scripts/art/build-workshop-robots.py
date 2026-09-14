"""Blender background authoring: ivory/cobalt rigid-joint workshop helpers.
Run: node scripts/art/export-agent-badges.cjs
Then: Blender --background --python scripts/art/build-workshop-robots.py
GLBs retain named pivots and a six-second blink/idle cycle; .blend is the editable source.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'services/app/public/landing/workshop/robots'
SOURCE = Path.home() / 'Downloads/artifactbin-workshop-robots.blend'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, rough=.45, metal=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    return m

ivory = material('Warm porcelain / pastel ivory', (.83,.79,.66), .37)
cream = material('Light cream enamel', (.96,.91,.78), .42)
blue = material('Cobalt blue enamel', (.004,.045,.32), .32, .05)
navy = material('Ink blue seam', (.012,.035,.065), .48)
rubber = material('Charcoal joint rubber', (.018,.024,.028), .58)
glass = material('Smoked monitor glass', (.005,.014,.018), .21, .12)
led = material('Warm screen eyes', (.91,.85,.64), .32)
steel = material('Brushed warm metal', (.32,.35,.34), .4, .6)
wood = material('Pale beech', (.55,.36,.17), .6)
brush = material('Brush bristles', (.76,.61,.36), .8)


def parent(obj, par):
    if par:
        world = obj.matrix_world.copy()
        obj.parent = par
        obj.matrix_world = world
    return obj

def finish(obj, name, mat, par=None):
    obj.name = name
    if mat: obj.data.materials.append(mat)
    bpy.context.view_layer.update()
    parent(obj, par)
    return obj

def pivot(name, pos, par=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = pos
    bpy.context.view_layer.update()
    parent(o, par)
    return o

def box(name, pos, size, mat, bevel=.04, par=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = bpy.context.object
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = o.modifiers.new('Soft enamel edges', 'BEVEL')
        b.width = bevel
        b.segments = 4
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=b.name)
    for p in o.data.polygons: p.use_smooth = True
    n = o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    bpy.ops.object.modifier_apply(modifier=n.name)
    return finish(o, name, mat, par)

def ball(name, pos, radius, mat, par=None, scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=radius, location=pos)
    o=bpy.context.object
    if scale: o.scale=scale
    for p in o.data.polygons: p.use_smooth=True
    return finish(o,name,mat,par)

def cylinder(name, a, b, radius, mat, par=None, r2=None):
    a,b=Vector(a),Vector(b)
    d=b-a
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=radius, radius2=radius if r2 is None else r2, depth=d.length, location=(a+b)/2)
    o=bpy.context.object
    o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
    bevel=o.modifiers.new('Rounded rim','BEVEL');bevel.width=.012;bevel.segments=3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    for p in o.data.polygons:p.use_smooth=True
    return finish(o,name,mat,par)

def link(name,a,b,width,depth,mat,par):
    a,b=Vector(a),Vector(b)
    o=box(name,(a+b)/2,(width,depth,(b-a).length),mat,min(width*.24,.055))
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    bpy.context.view_layer.update()
    return parent(o,par)

def hinge(name,pos,r,par):
    x,y,z=pos
    ball(name+' dark joint',pos,r,rubber,par)
    cylinder(name+' blue cap',(x,y-r*.88,z),(x,y-r*1.14,z),r*.76,blue,par)
    cylinder(name+' screw',(x,y-r*1.15,z),(x,y-r*1.19,z),r*.21,steel,par)

bot=pivot('Robot', (0,0,0))
# Feet, short jointed legs and enamel shin guards.
for side,x in [('Left',-.17),('Right',.17)]:
    hip=pivot(side+' hip',(x,0,.79),bot)
    hinge(side+' hip',(x,0,.79),.10,hip)
    knee=pivot(side+' knee',(x,-.035,.44),hip)
    link(side+' thigh',(x,0,.73),(x,-.035,.48),.17,.19,ivory,hip)
    hinge(side+' knee',(x,-.035,.44),.092,knee)
    link(side+' shin',(x,-.035,.40),(x,-.07,.18),.15,.17,cream,knee)
    ball(side+' ankle',(x,-.07,.14),.075,rubber,knee)
    box(side+' boot',(x,-.12,.075),(.22,.33,.14),rubber,.06,knee)
    box(side+' boot enamel',(x,-.135,.133),(.17,.21,.05),ivory,.02,knee)
box('Waist gasket',(0,0,.86),(.34,.27,.16),rubber,.055,bot)
box('Pelvis enamel',(0,-.005,.82),(.39,.29,.18),ivory,.055,bot)
body=pivot('Torso',(0,0,1.12),bot)
box('Torso back seam',(0,.016,1.15),(.48,.34,.53),navy,.10,body)
box('Torso ivory shell',(0,-.005,1.17),(.455,.35,.50),ivory,.10,body)
box('Chest inset',(0,-.185,1.20),(.28,.025,.27),cream,.04,body)

for x in [-.15,.15]:
    for z in [1.01,1.35]:
        cylinder('Torso fastening',(x,-.164,z),(x,-.19,z),.015,rubber,body)
cylinder('Neck collar',(0,0,1.39),(0,0,1.47),.105,rubber,body)
head=pivot('Head tilt',(0,0,1.70),body)
box('Monitor blue outline',(0,0,1.74),(.65,.46,.50),navy,.10,head)
box('Monitor porcelain case',(0,.014,1.747),(.70,.50,.55),cream,.095,head)
box('Monitor black bezel',(0,-.242,1.747),(.575,.065,.427),rubber,.087,head)
box('Monitor glass',(0,-.279,1.755),(.52,.025,.37),glass,.075,head)
# Agent identity is a printed chest decal; the face remains expressive.
screen_materials=[]
for agent in ['claude','codex','pi']:
    m=material('Agent chest badge / '+agent,(1,1,1),.5)
    m.use_fake_user=True
    image=bpy.data.images.load(str(OUT/('badge-'+agent+'.png')))
    image.pack()
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    bs=m.node_tree.nodes.get('Principled BSDF')
    m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value=.05
    m.node_tree.links.new(tex.outputs['Alpha'],bs.inputs['Alpha'])
    m.surface_render_method='DITHERED'
    screen_materials.append(m)
mesh=bpy.data.meshes.new('Screen UV plane')
mesh.from_pydata([(-.19,-.212,1.01),(.19,-.212,1.01),(.19,-.212,1.39),(-.19,-.212,1.39)],[],[(0,1,2,3)])
mesh.uv_layers.new(name='UVMap')
for loop,uv in zip(mesh.uv_layers.active.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=uv
screen=bpy.data.objects.new('Agent display',mesh);bpy.context.collection.objects.link(screen)
finish(screen,'Agent chest badge',screen_materials[0],body)
for m in screen_materials[1:]:mesh.materials.append(m)
eyes=[]
for x in [-.105,.105]:
    eye=ball('Blink eye '+str(x),(x,-.296,1.765),.06,led,head,scale=(.48,.12,1))
    eyes.append(eye)
box('Screen lower glint',(.105,-.296,1.62),(.075,.007,.008),navy,.003,head)
for side,x in [('L',-.345),('R',.345)]:
    cylinder(side+' ear joint',(x*.98,0,1.71),(x*1.06,0,1.71),.075,navy,head)
    cylinder(side+' ear cap',(x*1.06,0,1.71),(x*1.1,0,1.71),.056,ivory,head)
# Resting arm with visibly separate three-finger gripper.
shoulder=pivot('Left shoulder',(-.29,0,1.34),body)
hinge('Left shoulder',(-.29,0,1.34),.11,shoulder)
elbow=pivot('Left elbow',(-.40,-.025,1.06),shoulder)
link('Left upper sleeve',(-.30,0,1.30),(-.40,-.025,1.10),.15,.16,cream,shoulder)
hinge('Left elbow',(-.40,-.025,1.06),.082,elbow)
link('Left forearm',(-.40,-.025,1.02),(-.35,-.16,.86),.125,.14,ivory,elbow)
ball('Left wrist',(-.35,-.16,.84),.062,blue,elbow)
box('Left palm',(-.35,-.18,.78),(.13,.11,.12),rubber,.03,elbow)
for i,x in enumerate([-.40,-.35,-.30]):
    link('Left finger '+str(i),(x,-.19,.74),(x,-.22,.66),.032,.04,rubber,elbow)
# Raised arm: sleeve, elbow, wrist and an open pincer silhouette.
wave=pivot('Right shoulder / wave',(.29,0,1.34),body)
hinge('Right shoulder',(.29,0,1.34),.105,wave)
link('Right upper sleeve',(.32,0,1.38),(.51,0,1.58),.15,.16,cream,wave)
wave_elbow=pivot('Right elbow',(.54,0,1.62),wave)
hinge('Right elbow',(.54,0,1.62),.081,wave_elbow)
link('Right forearm',(.54,0,1.67),(.56,-.01,1.86),.12,.14,ivory,wave_elbow)
wrist=pivot('Right wrist / greeting',(.56,-.01,1.89),wave_elbow)
ball('Right wrist blue',(.56,-.01,1.89),.062,blue,wrist)
box('Right palm',(.56,-.01,1.98),(.14,.10,.12),rubber,.025,wrist)
for i, x in enumerate([.505,.56,.615]):
    link('Right finger '+str(i),(x,-.015,2.02),(x,-.04,2.115),.033,.035,rubber,wrist)
    ball('Right fingertip '+str(i),(x,-.04,2.115),.021,rubber,wrist)
link('Right thumb',(.63,-.01,1.97),(.69,-.07,2.03),.035,.04,rubber,wrist)

arm=pivot('Robotic arm',(0,0,0))
cylinder('Rubber base',(0,0,.02),(0,0,.07),.31,rubber,arm)
cylinder('Porcelain base',(0,0,.07),(0,0,.20),.30,ivory,arm,r2=.27)
for theta in range(0,360,60):
    x,y=.24*math.cos(math.radians(theta)),.24*math.sin(math.radians(theta))
    cylinder('Base screw',(x,y,.18),(x,y,.204),.022,rubber,arm)
turret=pivot('Arm turret',(0,0,.23),arm)
cylinder('Cobalt turntable',(0,0,.20),(0,0,.28),.19,blue,turret)
p0=(0,0,.34);p1=(.26,0,.86);p2=(-.16,0,1.24);p3=(-.67,0,1.32)
upper=pivot('Arm shoulder',p0,turret);hinge('Arm shoulder',p0,.14,upper)
link('Arm lower porcelain',p0,p1,.21,.20,cream,upper)
lower=pivot('Arm elbow',p1,upper);hinge('Arm elbow',p1,.15,lower)
link('Arm upper porcelain',p1,p2,.19,.19,ivory,lower)
fore=pivot('Arm forearm',p2,lower);hinge('Arm forearm',p2,.14,fore)
link('Arm wrist enamel',p2,p3,.145,.16,cream,fore)
end=pivot('Arm wrist',p3,fore);hinge('Arm wrist',p3,.10,end)
link('Gripper stem',p3,(-.84,0,1.32),.08,.10,rubber,end)
box('Gripper palm',(-.89,0,1.32),(.12,.19,.10),rubber,.025,end)
for s in [-1,1]:
    finger=pivot('Gripper '+str(s),(-.91,s*.07,1.32),end)
    link('Gripper finger',(-.91,s*.07,1.32),(-1.01,s*.11,1.23),.05,.055,rubber,finger)
    link('Gripper fingertip',(-1.01,s*.11,1.23),(-1.065,s*.026,1.22),.045,.055,rubber,finger)
# Held brush runs visibly beyond the closed fingers.
cylinder('Brush handle',(-.81,0,1.22),(-1.36,0,1.22),.027,blue,end,r2=.014)
cylinder('Brush ferrule',(-1.33,0,1.22),(-1.46,0,1.22),.028,steel,end)
cylinder('Brush bristles',(-1.45,0,1.22),(-1.62,0,1.22),.027,brush,end,r2=.005)

scene=bpy.context.scene
scene.frame_start=1;scene.frame_end=145;scene.render.fps=24
# Rigid links are parented to named pivots, avoiding stretchy skin deformation.
def animate(obj, axis, values):
    start=obj.rotation_euler[axis]
    for f,v in values:
        obj.rotation_euler[axis]=start+math.radians(v)
        obj.keyframe_insert(data_path='rotation_euler',frame=f)
    obj.rotation_euler[axis]=start
animate(head,2,[(1,-5),(37,5),(73,3),(109,-7),(145,-5)])
animate(head,1,[(1,-4),(49,3),(97,-2),(145,-4)])
animate(wrist,1,[(1,-12),(25,12),(49,-12),(73,12),(97,-12),(121,12),(145,-12)])
animate(wave_elbow,1,[(1,-4),(73,4),(145,-4)])
animate(turret,2,[(1,-8),(73,8),(145,-8)])
animate(lower,1,[(1,-5),(49,5),(97,0),(145,-5)])
animate(end,1,[(1,-6),(73,6),(145,-6)])
for eye in eyes:
    for f,h in [(1,1),(48,1),(51,.08),(54,1),(110,1),(113,.08),(116,1),(145,1)]:
        eye.scale.z=h
        eye.keyframe_insert(data_path='scale',frame=f)
scene.frame_set(1)

def descendants(o):
    return [o]+[a for c in o.children for a in descendants(c)]
def export(root,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in descendants(root):o.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.gltf(filepath=str(OUT/name),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='SCENE',export_frame_range=True)
export(bot,'workshop-bot.glb')
export(arm,'workshop-arm.glb')

# Author three role-specific poses, including actual hand/prop contact.
def clone_tree(obj, new_parent=None, mapping=None):
    if mapping is None:mapping={}
    new=obj.copy()
    if obj.type=='MESH':new.data=obj.data.copy()
    bpy.context.collection.objects.link(new)
    new.parent=new_parent
    mapping[obj]=new
    for child in obj.children:clone_tree(child,new,mapping)
    return new,mapping

def remove_tree(obj):
    for child in list(obj.children):remove_tree(child)
    bpy.data.objects.remove(obj,do_unlink=True)

def posed_arm(label,a,b,c,root,holding=False):
    p=pivot(label+' shoulder',a,root);hinge(label+' shoulder',a,.105,p)
    link(label+' upper sleeve',a,b,.15,.16,cream,p)
    e=pivot(label+' elbow',b,p);hinge(label+' elbow',b,.080,e)
    link(label+' forearm',b,c,.125,.14,ivory,e)
    ball(label+' wrist',c,.06,blue,e)
    x,y,z=c
    box(label+' palm',(x,y-.025,z-.045),(.13,.11,.12),rubber,.03,e)
    for i,dx in enumerate([-.042,0,.042]):
        if holding:
            link(label+' finger '+str(i),(x+dx,y-.07,z-.035),(x+dx,y-.105,z+.025),.030,.035,rubber,e)
            link(label+' curl '+str(i),(x+dx,y-.105,z+.025),(x+dx,y-.06,z+.060),.030,.035,rubber,e)
        else:
            link(label+' finger '+str(i),(x+dx,y-.04,z-.09),(x+dx,y-.07,z-.17),.030,.035,rubber,e)

def role_bot(role):
    variant,mapping=clone_tree(bot)
    variant.name='Robot / '+role
    remove_tree(mapping[shoulder]);remove_tree(mapping[wave])
    torso=mapping[body]
    if role=='standing':
        for sign in [-1,1]:
            if sign < 0:posed_arm(role+str(sign),(sign*.29,0,1.34),(sign*.40,-.025,1.06),(sign*.35,-.16,.84),torso)
            else:
                posed_arm('Pointing',(.29,0,1.34),(.49,-.025,1.53),(.73,-.08,1.73),torso)
                point_elbow=next(o for o in descendants(torso) if o.name.startswith('Pointing elbow') and o.type=='EMPTY')
                link('Pointing index finger',(.74,-.10,1.73),(.85,-.10,1.90),.033,.038,rubber,point_elbow)
    elif role=='pencil':
        cradle=pivot('Pencil cradle',(0,-.20,1.25),torso)
        posed_arm('Pencil left',(-.29,0,1.34),(-.46,-.20,1.02),(-.29,-.40,.78),cradle,True)
        posed_arm('Pencil right',(.29,0,1.34),(.43,-.18,1.06),(.27,-.40,.98),cradle,True)
        cylinder('Oversized cobalt pencil',(-1.0,-.42,.49),(.80,-.42,1.13),.085,blue,cradle)
        cylinder('Pencil upper carved wood',(.80,-.42,1.13),(1.04,-.42,1.215),.085,wood,cradle,r2=.016)
        cylinder('Pencil upper graphite',(1.04,-.42,1.215),(1.12,-.42,1.243),.016,blue,cradle,r2=0)
        cylinder('Pencil lower carved wood',(-1.0,-.42,.49),(-1.24,-.42,.405),.085,wood,cradle,r2=.016)
        cylinder('Pencil lower graphite',(-1.24,-.42,.405),(-1.32,-.42,.377),.016,blue,cradle,r2=0)
    elif role=='inspector':
        # A shallow squat with planted feet, bent knees and lowered hips.
        for child in list(variant.children):
            if child.name.startswith(('Left hip','Right hip')):
                remove_tree(child)
            else:
                child.location.z -= .20
        for side,x in [('Inspector left',-.19),('Inspector right',.19)]:
            h=(x,.08,.59);k=(x,-.22,.34);a=(x,-.07,.14)
            hinge(side+' hip',h,.10,variant)
            link(side+' thigh',h,k,.17,.19,ivory,variant)
            hinge(side+' knee',k,.092,variant)
            link(side+' shin',k,a,.15,.17,cream,variant)
            ball(side+' ankle',a,.075,rubber,variant)
            box(side+' boot',(x,-.12,.075),(.22,.33,.14),rubber,.06,variant)
            box(side+' boot enamel',(x,-.135,.133),(.17,.21,.05),ivory,.02,variant)
        posed_arm('Inspector left',(-.29,0,1.14),(-.40,-.22,.91),(-.30,-.34,.71),torso)
        posed_arm('Inspector right',(.29,0,1.14),(.48,-.22,1.00),(.40,-.55,1.14),torso,True)
        grip=next(o for o in descendants(torso) if o.name=='Inspector right elbow')
        cylinder('Magnifying glass cobalt handle',(.40,-.56,1.12),(.25,-.65,1.27),.045,blue,grip)
        bpy.ops.mesh.primitive_torus_add(major_radius=.20,minor_radius=.035,major_segments=48,minor_segments=12,location=(.12,-.69,1.42),rotation=(1.35,0,0))
        finish(bpy.context.object,'Magnifying glass ivory rim',blue,grip)
        cylinder('Lens highlight',(-.02,-.72,1.55),(.10,-.73,1.61),.014,led,grip)
    else:
        posed_arm('Paper left',(-.29,0,1.34),(-.46,-.03,1.10),(-.55,-.18,1.24),torso)
        # Bent elbows leave both hands free for a playful dance.
        posed_arm('Paper right',(.29,0,1.34),(.46,-.03,1.10),(.55,-.18,1.24),torso)
    return variant

variants={role:role_bot(role) for role in ['standing','pencil','paper','inspector']}
for role,variant in variants.items():
    export(variant,'workshop-bot-'+role+'.glb')
    for obj in descendants(variant):obj.hide_render=True
# Default model review uses the standing pose, with an expressive face.
export(variants['standing'],'workshop-bot.glb')
for obj in descendants(bot):obj.hide_render=True
bot=variants['standing']
for obj in descendants(bot):obj.hide_render=False
# Separate beauty-stage placement, not baked into either GLB's origin.
bot.location.x=-1.02
arm.location.x=1.55
arm.location.z=.30
box('Display plinth',(1.55,0,.14),(.90,.72,.28),wood,.025)
floor=material('Backdrop / warm parchment',(.83,.79,.68),.88)
box('Ground',(0,0,-.07),(200,200,.1),floor,.0)
scene.world.color=(.6,.6,.6)
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.92,.86,.76,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45

def light(name,loc,energy,size):
    bpy.ops.object.light_add(type='AREA',location=loc)
    o=bpy.context.object;o.name=name;o.data.energy=energy;o.data.shape='DISK';o.data.size=size
    o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
light('Large soft window',(-3,-4,6),650,5)
light('Warm fill',(4,-1,4),280,4)
light('Top rim',(1,3,5),480,3)
bpy.ops.object.camera_add(location=(3.5,-7.5,3.1))
camera=bpy.context.object
camera.rotation_euler=(Vector((.25,0,1.03))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=4.7
scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=40
scene.cycles.use_denoising=True
scene.render.resolution_x=1500;scene.render.resolution_y=1050;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(OUT/'workshop-helpers.png')
scene.frame_set(24)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))
bpy.ops.render.render(write_still=True)
print('WORKSHOP_ASSETS_READY', OUT, SOURCE)
