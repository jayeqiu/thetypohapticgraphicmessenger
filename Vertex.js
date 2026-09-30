const PUSH_RADIUS = 46, PUSH_STRENGTH = 3.4;
const DAMPING = 0.72;

class Vertex {
    constructor(p){ 
        this.pos = p.copy(); 
        this.vel = createVector(0,0); 
    }

    update(){
        this.vel.mult(DAMPING); 
        this.pos.add(this.vel);
    }
    pushAway(fPos, radius = PUSH_RADIUS){
        let d = p5.Vector.sub(this.pos, fPos);
        let dd = d.mag();
        if (dd < radius && dd > 0.001){
            let s = (radius - dd) / radius;
            d.normalize().mult(s * PUSH_STRENGTH);
            this.vel.add(d);
        }
    }
    radialOutward(center, maxR, strength){
        let d = p5.Vector.sub(this.pos, center);
        let dd = d.mag();
        if (dd < maxR){
        d.normalize().mult(strength);
        this.vel.add(d);
        }
    }
}