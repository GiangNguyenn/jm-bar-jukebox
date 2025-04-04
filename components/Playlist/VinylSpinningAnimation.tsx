import React from "react";
import Image from "next/image";

interface IVinylSpinningAnimationProps {
  is_playing: boolean;
  albumCover?: string;
}

const VinylSpinningAnimation: React.FC<IVinylSpinningAnimationProps> = ({
  is_playing,
  albumCover,
}) => {
  return (
    <div className="relative flex items-center justify-center p-2">
      <div
        className={`relative w-32 h-32 rounded-full border-8 border-gray-800 bg-black shadow-lg ${
          is_playing ? "animate-spinSlow" : ""
        }`}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 rounded-full border-4 border-gray-900 bg-black"></div>
        </div>

        {albumCover && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Image
              src={albumCover}
              alt="Album Cover"
              width={80}
              height={80}
              className="rounded-full object-cover border-2 border-gray-800"
            />
          </div>
        )}

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3 h-3 bg-gray-600 rounded-full"></div>
        </div>
      </div>
    </div>
  );
};

export default VinylSpinningAnimation;
