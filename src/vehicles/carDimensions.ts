// Car sizes and masses, shared by the models (carModel.ts), the physics (sim/carDynamics.ts)
// and the headless RL simulator (rl/). No three.js here, so Node can import it.

export type CarType = 'sedan' | 'taxi' | 'van';

export interface CarDimensions {
  length: number;
  width: number;
  wheelBase: number; // distance between axles
  track: number; // distance between left and right wheel centres
  wheelRadius: number;
  /** Physics collision box (half extents and centre), for the chassis. */
  boxHalf: [number, number, number];
  boxCenter: [number, number, number];
  mass: number; // kg
}

export const CAR_DIMENSIONS: Record<CarType, CarDimensions> = {
  sedan: {
    length: 4.5, width: 1.8, wheelBase: 2.7, track: 1.56, wheelRadius: 0.34,
    boxHalf: [2.2, 0.36, 0.88], boxCenter: [0, 0.68, 0], mass: 1300,
  },
  taxi: {
    length: 4.5, width: 1.8, wheelBase: 2.7, track: 1.56, wheelRadius: 0.34,
    boxHalf: [2.2, 0.36, 0.88], boxCenter: [0, 0.68, 0], mass: 1300,
  },
  van: {
    length: 4.9, width: 1.95, wheelBase: 3.0, track: 1.66, wheelRadius: 0.37,
    boxHalf: [2.4, 0.78, 0.95], boxCenter: [0, 1.12, 0], mass: 2000,
  },
};
